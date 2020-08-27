"use strict";
/*
var TEST_CUSTOMER_KEY = '1a6d7f0de15335c201e8e9aacbc7a0952f5191d7';
var TOUCHSTONE_SERVICE_URL = 'http://conviva.testonly.conviva.com';
var convivaConfigs = {};
convivaConfigs[Conviva.Constants.GATEWAY_URL] = TOUCHSTONE_SERVICE_URL;
convivaConfigs[Conviva.Constants.LOG_LEVEL] = Conviva.Constants.LogLevel.DEBUG;
convivaConfigs[Conviva.Constants.CUSTOMER_KEY] = TEST_CUSTOMER_KEY;
*/
const CONVIVA_CALLBACK_FUNCTIONS = {
    [Conviva.Constants.CallbackFunctions.CONSOLE_LOG](message, logLevel) {
        if (typeof console === 'undefined') {
            return;
        }
        if (console.log && logLevel === Conviva.SystemSettings.LogLevel.DEBUG ||
            logLevel === Conviva.SystemSettings.LogLevel.INFO) {
            console.log(message);
        } else if (console.warn && logLevel === Conviva.SystemSettings.LogLevel.WARNING) {
            console.warn(message);
        } else if (console.error && logLevel === Conviva.SystemSettings.LogLevel.ERROR) {
            console.error(message);
        }
    },
    [Conviva.Constants.CallbackFunctions.MAKE_REQUEST](httpMethod, url, data, contentType, timeoutMs, callback) {
        let xmlHttpReq = new XMLHttpRequest();
        xmlHttpReq.open(httpMethod, url, true);
        if (contentType && xmlHttpReq.overrideMimeType) {
            xmlHttpReq.overrideMimeType = contentType;
        }
        if (contentType && xmlHttpReq.setRequestHeader) {
            xmlHttpReq.setRequestHeader('Content-Type', contentType);
        }
        if (timeoutMs > 0) {
            xmlHttpReq.timeout = timeoutMs;
            xmlHttpReq.ontimeout = () => {
                // Often this callback will be called after onreadystatechange.
                // The first callback called will cleanup the other to prevent duplicate responses.
                xmlHttpReq.ontimeout = xmlHttpReq.onreadystatechange = null;
                if (callback) {
                    callback(false, 'timeout after ' + timeoutMs + ' ms');
                }
            };
        }
        xmlHttpReq.onreadystatechange = () => {
            if (xmlHttpReq.readyState === 4) {
                xmlHttpReq.ontimeout = xmlHttpReq.onreadystatechange = null;
                if (xmlHttpReq.status === 200) {
                    if (callback) {
                        callback(true, xmlHttpReq.responseText);
                    }
                } else if (callback) {
                    callback(false, 'http status ' + xmlHttpReq.status);
                }
            }
        };
        xmlHttpReq.send(data);
    },
    [Conviva.Constants.CallbackFunctions.SAVE_DATA](storageSpace, storageKey, data, callback) {
        let localStorageKey = storageSpace + '.' + storageKey;
        try {
            localStorage.setItem(localStorageKey, data);
            callback(true, undefined);
        } catch (e) {
            callback(false, e.toString());
        }
    },
    [Conviva.Constants.CallbackFunctions.LOAD_DATA](storageSpace, storageKey, callback) {
        let localStorageKey = storageSpace + '.' + storageKey;
        try {
            let data = localStorage.getItem(localStorageKey);
            callback(true, data);
        } catch (e) {
            callback(false, e.toString());
        }
    },
    [Conviva.Constants.CallbackFunctions.GET_EPOCH_TIME_IN_MS]() {
        let d = new Date();
        return d.getTime();
    },
    [Conviva.Constants.CallbackFunctions.CREATE_TIMER](timerAction, intervalMs) {
        let timerId = setInterval(timerAction, intervalMs);
        return () => {
            if (timerId !== -1) {
                clearInterval(timerId);
                timerId = -1;
            }
        };
    }
};

function collectDeviceMetadata() {
    return {
        // [Conviva.Constants.DeviceMetadata.BRAND]: "Apple",
        // [Conviva.Constants.DeviceMetadata.MANUFACTURER]: "Apple",
        // [Conviva.Constants.DeviceMetadata.MODEL]: "MacBookPro",
        [Conviva.Constants.DeviceMetadata.TYPE]: Conviva.Constants.DeviceType.DESKTOP,
        // [Conviva.Constants.DeviceMetadata.VERSION]: "NAForMac",
        // [Conviva.Constants.DeviceMetadata.OS_NAME]: "MAC",
        // [Conviva.Constants.DeviceMetadata.OS_VERSION]: "10.13.6",
        [Conviva.Constants.DeviceMetadata.CATEGORY]: Conviva.Constants.DeviceCategory.WEB
    };
}

function collectPlayerInfo() {
    return {
        [Conviva.Constants.FRAMEWORK_NAME]: 'THEOplayer HTML5',
        [Conviva.Constants.FRAMEWORK_VERSION]: 'NaForHTML5'
    };
}

function collectContentMetdata(player, configuredContentMetadata) {
    return Object.assign({
        [Conviva.Constants.STREAM_URL]: player.src,
        [Conviva.Constants.PLAYER_NAME]: 'THEOplayer',
        [Conviva.Constants.DURATION]: player.duration
    }, configuredContentMetadata);
}

function collectAdMetadata(ad) {
    return {
        [Conviva.Constants.ASSET_NAME]: ad.title || ad.id,
        [Conviva.Constants.STREAM_URL]: ad.mediaUrl || ad.resourceURI,
        [Conviva.Constants.PLAYER_NAME]: 'THEOplayer',
        [Conviva.Constants.DURATION]: ad.duration,
        [Conviva.Constants.IS_LIVE]: Conviva.Constants.StreamType.VOD
    };
}

function calculateBufferLength(player) {
    const buffered = player.buffered;
    if (buffered === undefined) {
        return;
    }
    let bufferLength = 0;
    for (let i = 0; i < buffered.length; i += 1) {
        const start = buffered.start(i);
        const end = buffered.end(i);
        if (start <= player.currentTime && player.currentTime < end) {
            bufferLength += end - player.currentTime;
        }
    }
    return bufferLength * 1000;
}

function findCurrentLinearAd(ads) {
    for (let ad of ads) {
        if (ad.type === 'linear') {
            return ad;
        }
    }
    return undefined;
}

class NewConvivaIntegration {
    constructor(player, convivaConfiguration, contentMetadataReceiver) {
        this._convivaVideoAnalytics = undefined;
        this._convivaAdAnalytics = undefined;
        this._isFirstContentPlay = true;
        this._isAdBreakEnabled = true;
        this._contentPlaybackEnded = false;
        this._allAdsCompleted = true;
        this._isPlayingAd = false;
        this._isPlayingPostRoll = false;
        this._currentAdBreak = undefined;
        this._adBreakStartSent = false;
        this._adStartSent = false;
        this._onPlayerLoadedMetadata = () => {
            if (!this._player) {
                return;
            }
            if (!this._isPlayingAd && this._convivaVideoAnalytics) {
                const duration = this._player.duration;
                if (!isNaN(duration) && duration !== Infinity) {
                    const contentInfo = {
                        [Conviva.Constants.DURATION]: duration
                    };
                    this._convivaVideoAnalytics.setContentInfo(contentInfo);

                }
                this._convivaVideoAnalytics.reportPlaybackMetric(Conviva.Constants.Playback.RESOLUTION, this._player.videoWidth, this._player.videoHeight);
            }
        };
        this._onPlayerPlay = () => {
            if (!this._player) {
                return;
            }
            if (this._isFirstContentPlay) {
                if (!this._convivaVideoAnalytics) {
                    this._initConvivaClient(convivaConfiguration);
                }

                this._convivaVideoAnalytics.reportPlaybackRequested(collectContentMetdata(this._player, contentMetadataReceiver(this._player.source)));
            }
            this._isFirstContentPlay = false;
        };
        this._onPlayerPlaying = () => {
            if (!this._player) {
                return;
            }
            if (!this._isPlayingAd && this._convivaVideoAnalytics) {
                this._convivaVideoAnalytics.reportPlaybackMetric(Conviva.Constants.Playback.PLAYER_STATE, Conviva.Constants.PlayerState.PLAYING);

            }
        };
        this._onPlayerPause = () => {
            if (!this._player) {
                return;
            }
            if (!this._isPlayingAd && this._convivaVideoAnalytics) {
                this._convivaVideoAnalytics.reportPlaybackMetric(Conviva.Constants.Playback.PLAYER_STATE, Conviva.Constants.PlayerState.PAUSED);

            }
        };
        this._onPlayerWaiting = () => {
            if (!this._player) {
                return;
            }
            if (!this._isPlayingAd && this._convivaVideoAnalytics) {
                this._convivaVideoAnalytics.reportPlaybackMetric(Conviva.Constants.Playback.PLAYER_STATE, Conviva.Constants.PlayerState.BUFFERING);

            }
        };
        this._onPlayerSeeking = () => {
            if (!this._player) {
                return;
            }
            if (!this._isPlayingAd && this._convivaVideoAnalytics) {
                this._convivaVideoAnalytics.reportPlaybackMetric(Conviva.Constants.Playback.SEEK_STARTED);

            }
        };
        this._onPlayerSeeked = () => {
            if (!this._player) {
                return;
            }
            if (!this._isPlayingAd && this._convivaVideoAnalytics) {
                this._convivaVideoAnalytics.reportPlaybackMetric(Conviva.Constants.Playback.SEEK_ENDED);

            }
        };
        this._onPlayerError = () => {
            if (!this._player) {
                return;
            }
            if (!this._convivaVideoAnalytics) {
                this._convivaVideoAnalytics = Conviva.Analytics.buildVideoAnalytics();

            }
            this._convivaVideoAnalytics.reportPlaybackFailed('Fatal error occured');
            this._convivaVideoAnalytics.release();
            this._convivaVideoAnalytics = undefined;
            Conviva.Analytics.release();
            this._contentPlaybackEnded = true;
        };
        this._onSegmentNotFound = () => {
            if (!this._player) {
                return;
            }
            if (!this._convivaVideoAnalytics) {
                this._convivaVideoAnalytics = Conviva.Analytics.buildVideoAnalytics();
            }
            this._convivaVideoAnalytics.reportPlaybackError('A Video Playback Failure has occurred: Segment not found', Conviva.Constants.ErrorSeverity.FATAL);
        };
        this._reportManifestOffline = () => {
            if (!this._player) {
                return;
            }
            if (!this._convivaVideoAnalytics) {
                this._convivaVideoAnalytics = Conviva.Analytics.buildVideoAnalytics();
                log('Conviva.Analytics', `buildVideoAnalytics()`);
            }
            this._convivaVideoAnalytics.reportPlaybackError('A Video Playback Failure has occurred: Waiting for the manifest to come back online', Conviva.Constants.ErrorSeverity.FATAL);
        };
        this._onPlayerEmptied = () => {
            if (!this._player) {
                return;
            }
            if (!this._isPlayingAd && this._convivaVideoAnalytics && this._currentSource !== this._player.source) {
                if (this._convivaAdAnalytics) {
                    this._convivaAdAnalytics.release();
                    this._convivaAdAnalytics = undefined;
                }
                this._convivaVideoAnalytics.release();
                this._convivaVideoAnalytics = undefined;
                Conviva.Analytics.release();
                this._currentSource = undefined;
            }
        };
        this._onSourceChange = () => {
            if (!this._player) {
                return;
            }
            if (this._currentSource === this._player.source) {
                return;
            }
            if (this._convivaVideoAnalytics) {
                this._onPlayerEmptied();
            }
            this._currentSource = this._player.source;
            this._initConvivaClient(convivaConfiguration);
        };
        this._onPlayerEnded = () => {
            if (!this._player) {
                return;
            }
            if (!this._isPlayingAd && this._convivaVideoAnalytics) {
                this._convivaVideoAnalytics.reportPlaybackMetric(Conviva.Constants.Playback.PLAYER_STATE, Conviva.Constants.PlayerState.STOPPED);

                if (this._allAdsCompleted) {
                    this._convivaVideoAnalytics.reportPlaybackEnded();

                    this._convivaVideoAnalytics.release();

                    this._convivaVideoAnalytics = undefined;
                    Conviva.Analytics.release();

                }
            }
            this._contentPlaybackEnded = true;
            this._isFirstContentPlay = true;
        };
        this._onPlayerDestroyed = () => {
            this.destroy();
        };
        this._onAdStopped = () => {
            if (!this._player) {
                return;
            }
            if (this._convivaAdAnalytics) {
                this._convivaAdAnalytics.reportAdMetric(Conviva.Constants.Playback.PLAYER_STATE, Conviva.Constants.PlayerState.STOPPED);
                this._convivaAdAnalytics.reportAdSkipped();
                this._convivaAdAnalytics.release();
                this._convivaAdAnalytics = undefined;
            }
        };
        this._onAdBuffering = () => {
            if (!this._player) {
                return;
            }
            if (this._convivaAdAnalytics) {
                this._convivaAdAnalytics.reportAdMetric(Conviva.Constants.Playback.PLAYER_STATE, Conviva.Constants.PlayerState.BUFFERING);
            }
        };
        this._onAdBreakBegin = () => {
            if (!this._player) {
                return;
            }
            this._isPlayingAd = true;
            this._allAdsCompleted = false;
            if (this._convivaVideoAnalytics && this._player.ads) {
                if (this._isAdBreakEnabled) {
                    const currentAdBreak = this._currentAdBreak = this._player.ads.currentAdBreak || undefined;
                    if (!currentAdBreak) {
                        return;
                    }
                    const currentAdBreakTimeOffset = currentAdBreak.timeOffset;
                    let currentAdBreakPosition;
                    if (currentAdBreakTimeOffset === 0) {
                        currentAdBreakPosition = 'Pre-roll';
                    } else if (currentAdBreakTimeOffset < 0) {
                        currentAdBreakPosition = 'Post-roll';
                        this._isPlayingPostRoll = true;
                    } else {
                        currentAdBreakPosition = 'Mid-roll';
                    }
                    const currentAdBreakIndex = this._player.ads.scheduledAdBreaks.indexOf(currentAdBreak);
                    const convivaAdBreakInfo = {
                        [Conviva.Constants.POD_POSITION]: currentAdBreakPosition,
                        [Conviva.Constants.POD_DURATION]: currentAdBreak.maxDuration,
                        [Conviva.Constants.POD_INDEX]: currentAdBreakIndex
                    };
                    this._convivaVideoAnalytics.reportAdBreakStarted(Conviva.Constants.AdType.CLIENT_SIDE, Conviva.Constants.AdPlayer.CONTENT, convivaAdBreakInfo);
                    this._adBreakStartSent = true;
                } else {
                    this._convivaVideoAnalytics.reportPlayerInFocus(false);
                }
            }
        };
        this._onAdBreakEnd = () => {
            if (!this._player || !this._player.ads) {
                return;
            }
            if (this._convivaVideoAnalytics) {
                if (this._isAdBreakEnabled) {
                    if (this._adBreakStartSent) {
                        this._convivaVideoAnalytics.reportAdBreakEnded();

                    }
                } else {
                    if (!this._isPlayingPostRoll) {
                        this._convivaVideoAnalytics.reportPlayerInFocus(true);

                    }
                }
                if (this._isPlayingPostRoll) {
                    this._convivaVideoAnalytics.reportPlaybackEnded();
                    this._convivaVideoAnalytics.release();
                    this._convivaVideoAnalytics = undefined;
                    Conviva.Analytics.release();
                    this._contentPlaybackEnded = true;
                    this._allAdsCompleted = true;
                }
            }
            const scheduledAdBreaks = this._player.ads.scheduledAdBreaks;
            if (scheduledAdBreaks[scheduledAdBreaks.length - 1] === this._currentAdBreak) {
                this._allAdsCompleted = true;
            }
            this._adBreakStartSent = false;
            this._isPlayingAd = false;
            this._currentAdBreak = undefined;
        };
        this._onAdBegin = () => {
            if (!this._player) {
                return;
            }
            this._adStartSent = false;
            this._player.addEventListener('playing', this._onAdsPlayerPlaying);
            this._player.addEventListener('pause', this._onAdsPlayerPause);
        };
        this._onAdsPlayerPlaying = () => {
            if (!this._player || !this._player.ads) {
                return;
            }

            const currentLinearAd = findCurrentLinearAd(this._player.ads.currentAds);
            if (currentLinearAd) {
                if (this._adStartSent) {
                    if (this._convivaAdAnalytics) {
                        this._convivaAdAnalytics.reportAdMetric(Conviva.Constants.Playback.PLAYER_STATE, Conviva.Constants.PlayerState.PLAYING);

                    }
                } else {
                    if (!this._convivaAdAnalytics) {
                        this._convivaAdAnalytics = Conviva.Analytics.buildAdAnalytics(this._convivaVideoAnalytics);

                    }
                    if (this._convivaAdAnalytics) {
                        const adMetadata = collectAdMetadata(currentLinearAd);
                        this._convivaAdAnalytics.setAdInfo(adMetadata);
                        this._convivaAdAnalytics.reportAdLoaded();
                        this._convivaAdAnalytics.reportAdStarted();
                        this._adStartSent = true;
                        this._convivaAdAnalytics.reportAdMetric(Conviva.Constants.Playback.PLAYER_STATE, Conviva.Constants.PlayerState.PLAYING);
                        this._convivaAdAnalytics.reportAdMetric(Conviva.Constants.Playback.RESOLUTION, this._player.videoWidth, this._player.videoHeight);
                        this._convivaAdAnalytics.reportAdMetric(Conviva.Constants.Playback.BITRATE, currentLinearAd.bitrate || 0);
                    }
                }
            }
        };
        this._onAdsPlayerPause = () => {
            if (!this._player || !this._player.ads) {
                return;
            }

            const currentLinearAd = findCurrentLinearAd(this._player.ads.currentAds);
            if (currentLinearAd && this._convivaAdAnalytics) {
                this._convivaAdAnalytics.reportAdMetric(Conviva.Constants.Playback.PLAYER_STATE, Conviva.Constants.PlayerState.PAUSED);
            }
        };
        this._onAdEnd = () => {
            if (!this._player || !this._player.ads) {
                return;
            }
            const currentLinearAd = findCurrentLinearAd(this._player.ads.currentAds);
            if (currentLinearAd) {
                return; // it's not the linear ad which ended
            }
            if (this._convivaAdAnalytics) {
                this._convivaAdAnalytics.reportAdEnded();

            }
            if (this.contentPlaybackEnded && this._convivaVideoAnalytics) {
                convivaVideoAnalytics.reportPlaybackEnded();
                convivaVideoAnalytics.release();
                convivaVideoAnalytics = undefined;
                Conviva.Analytics.release();

            }
            this._player.removeEventListener('playing', this._onAdsPlayerPlaying);
            this._player.removeEventListener('pause', this._onAdsPlayerPause);
        };
        this._onAdsError = (event) => {
            if (!this._player) {
                return;
            }
            this._player.removeEventListener('playing', this._onAdsPlayerPlaying);
            this._player.removeEventListener('pause', this._onAdsPlayerPause);
            if (!this._convivaAdAnalytics) {
                this._convivaAdAnalytics = Conviva.Analytics.buildAdAnalytics(convivaVideoAnalytics);

            }
            if (this._convivaAdAnalytics) {
                this._convivaAdAnalytics.reportAdFailed(event.message || 'Ad Request Failed');
                this._convivaAdAnalytics.release();
                this._convivaAdAnalytics = undefined;
            }
        };
        this._player = player;
        this._currentSource = player.source;
        this._initConvivaClient(convivaConfiguration);
        this._registerVideoListeners();
        this._registerAdsLoaderListeners();
    }
    _initConvivaClient(convivaConfiguration) {
        Conviva.Analytics.init(convivaConfiguration[Conviva.Constants.CUSTOMER_KEY], CONVIVA_CALLBACK_FUNCTIONS, convivaConfiguration);
        Conviva.Analytics.setDeviceMetadata(collectDeviceMetadata());
        if (!this._convivaVideoAnalytics) {
            // Create a monitoring session for content
            this._convivaVideoAnalytics = Conviva.Analytics.buildVideoAnalytics();
            this._convivaVideoAnalytics.setPlayerInfo(collectPlayerInfo());
            this._convivaVideoAnalytics.setCallback(() => {
                if (this._convivaVideoAnalytics) {
                    if (this._player) {
                        this._convivaVideoAnalytics.reportPlaybackMetric(Conviva.Constants.Playback.PLAY_HEAD_TIME, this._player.currentTime * 1000);
                        this._convivaVideoAnalytics.reportPlaybackMetric(Conviva.Constants.Playback.BUFFER_LENGTH, calculateBufferLength(this._player));
                        this._convivaVideoAnalytics.reportPlaybackMetric(Conviva.Constants.Playback.RESOLUTION, this._player.videoWidth, this._player.videoHeight);

                        const activeVideoTrack = this._player.videoTracks[0];
                        const activeQuality = activeVideoTrack && activeVideoTrack.activeQuality;
                        if (activeQuality) {
                            if (!isNaN(activeQuality.bandwidth)) {
                                this._convivaVideoAnalytics.reportPlaybackMetric(Conviva.Constants.Playback.BITRATE, activeQuality.bandwidth / 1000);

                            }

                            if (!isNaN(activeQuality.frameRate)) {
                                this._convivaVideoAnalytics.reportPlaybackMetric(Conviva.Constants.Playback.RENDERED_FRAMERATE, activeQuality.frameRate);

                            }
                        }
                    }
                }
            });
            this._isFirstContentPlay = true;
            this._isAdBreakEnabled = true;
            this._contentPlaybackEnded = false;
            this._allAdsCompleted = true;
            this._isPlayingAd = false;
            this._isPlayingPostRoll = false;
            this._currentAdBreak = undefined;
            this._adBreakStartSent = false;
            this._adStartSent = false;
        }
    }
    _registerVideoListeners() {
        this._player.addEventListener('play', this._onPlayerPlay);
        this._player.addEventListener('pause', this._onPlayerPause);
        this._player.addEventListener('playing', this._onPlayerPlaying);
        this._player.addEventListener('emptied', this._onPlayerEmptied);
        this._player.addEventListener('waiting', this._onPlayerWaiting);
        this._player.addEventListener('error', this._onPlayerError);
        this._player.addEventListener('loadedmetadata', this._onPlayerLoadedMetadata);
        this._player.addEventListener('seeking', this._onPlayerSeeking);
        this._player.addEventListener('seeked', this._onPlayerSeeked);
        this._player.addEventListener('ended', this._onPlayerEnded);
        this._player.addEventListener('loadstart', this._onPlayerWaiting);
        this._player.addEventListener('segmentnotfound', this._onSegmentNotFound);
        this._player.addEventListener('destroy', this._onPlayerDestroyed);
        this._player.addEventListener('sourcechange', this._onSourceChange);

        if (this._player.network) {
            this._player.network.addEventListener('offline', this._reportManifestOffline);
        }
    }
    _registerAdsLoaderListeners() {
        if (!this._player.ads) {
            return;
        }
        this._convivaAdAnalytics = Conviva.Analytics.buildAdAnalytics(this._convivaVideoAnalytics);
        this._player.ads.addEventListener('aderror', this._onAdsError);
        this._player.ads.addEventListener('adbreakbegin', this._onAdBreakBegin);
        this._player.ads.addEventListener('adbreakend', this._onAdBreakEnd);
        this._player.ads.addEventListener('adbegin', this._onAdBegin);
        this._player.ads.addEventListener('adend', this._onAdEnd);
        this._player.ads.addEventListener('adskip', this._onAdStopped);
        this._player.ads.addEventListener('adbuffering', this._onAdBuffering);
    }
    destroy() {
        if (!this._player) {
            return;
        }

        this._player.removeEventListener('play', this._onPlayerPlay);
        this._player.removeEventListener('pause', this._onPlayerPause);
        this._player.removeEventListener('playing', this._onPlayerPlaying);
        this._player.removeEventListener('emptied', this._onPlayerEmptied);
        this._player.removeEventListener('waiting', this._onPlayerWaiting);
        this._player.removeEventListener('error', this._onPlayerError);
        this._player.removeEventListener('loadedmetadata', this._onPlayerLoadedMetadata);
        this._player.removeEventListener('seeking', this._onPlayerSeeking);
        this._player.removeEventListener('seeked', this._onPlayerSeeked);
        this._player.removeEventListener('ended', this._onPlayerEnded);
        this._player.removeEventListener('loadstart', this._onPlayerWaiting);
        this._player.removeEventListener('segmentnotfound', this._onSegmentNotFound);
        this._player.removeEventListener('destroy', this._onPlayerDestroyed);
        this._player.removeEventListener('sourcechange', this._onSourceChange);

        try {
            if (this._player.network) {
                this._player.network.removeEventListener('offline', this._reportManifestOffline);
            }
        } catch (ignore) {}

        if (this._player.ads) {
            this._player.ads.removeEventListener('aderror', this._onAdsError);
            this._player.ads.removeEventListener('adbreakbegin', this._onAdBreakBegin);
            this._player.ads.removeEventListener('adbreakend', this._onAdBreakEnd);
            this._player.ads.removeEventListener('adbegin', this._onAdBegin);
            this._player.ads.removeEventListener('adend', this._onAdEnd);
            this._player.ads.removeEventListener('adskip', this._onAdStopped);
            this._player.ads.removeEventListener('adbuffering', this._onAdBuffering);
        }

        if (this._convivaAdAnalytics) {
            this._convivaAdAnalytics.release();

        }
        if (this._convivaVideoAnalytics) {
            this._convivaVideoAnalytics.release();

        }
        Conviva.Analytics.release();

        this._player = undefined;
        this._convivaVideoAnalytics = undefined;
        this._convivaAdAnalytics = undefined;
        this._currentAdBreak = undefined;
    }
}