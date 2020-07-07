# THEOplayer Conviva Plugin with Ad Insights

## Introduction

In order to get a common understanding of how the THEOplayer SDKs integrates with Conviva Analytics, we have demonstrated in an example to have better explaination and clear points to integerate easily. 

Conviva is an analytics service. THEOplayer offers a integration plugin for this solution. A demo can be found at [Conviva Analytics Test Page](https://cdn.theoplayer.com/conviva/conviva_test.html).

### Table of Contents
- [SDKs](#sdks)
- [Code example](#code-example)
  - [Pre-requirements](#pre-requirements)
  - [Configuration](#configuration)
- [Related links:](#related-links)
  
## SDKs

| Web SDK | Android SDK | iOS SDK | tvOS SDK| Android TV SDK | Chromecast SDK | Tizen | WebOS |
| :-----: | :---------: | :-----: | :--: | :------------: | :------------: | :----: | :----: |
|   Yes   |     No     |   No   | No  |      Yes       |      Unverified       |  Unverified | Unverified |

## Code example

### Pre-requirements

##### Web SDK

1. Have a THEOplayer SDK.
2. Setup the [Basic Getting Started with THEOplayer](https://docs.portal.theoplayer.com/getting-started/01-sdks/01-web/00-getting-started.md) 
2. Include Conviva's SDK. For example,
```html
//Recommended Conviva Library
<script type='text/javascript' src='//cdn.theoplayer.com/conviva/conviva-4.0.14.js'></script>

//THEOplayer Integrated Module with Conviva 
<script type='text/javascript' src='//cdn.theoplayer.com/conviva/conviva_theoplayer_plugin.js'></script>
```
Note: You can also Clone the repo to have the local version of Plugin and include the file in the `script` tag.

### Configuration

The snippets below explain how you can pass on Conviva settings to a THEOplayer configuration object.

##### Web SDK

1. Setting up of your conviva configurations like below: 

```js
        var TEST_CUSTOMER_KEY = '876a2328cc34e791190d855daf389567c96d1e86';
        var TOUCHSTONE_SERVICE_URL = 'https://theoplayer-test.testonly.conviva.com';
        var convivaConfigs = {};
        
        convivaConfigs[Conviva.Constants.GATEWAY_URL] = TOUCHSTONE_SERVICE_URL;
        convivaConfigs[Conviva.Constants.LOG_LEVEL] = Conviva.Constants.LogLevel.DEBUG;
        convivaConfigs[Conviva.Constants.CUSTOMER_KEY] = TEST_CUSTOMER_KEY;
```

2. Initialise THEOplayer-conviva plugin with the parameters including any metatdata for that particular asset.

```js
//Prepare the metadata Content Info
var contentInfo = {};
contentInfo[Conviva.Constants.ASSET_NAME] = assetName;
contentInfo[Conviva.Constants.STREAM_URL] = url;
contentInfo[Conviva.Constants.IS_LIVE] = Conviva.Constants.StreamType.LIVE;
contentInfo[Conviva.Constants.PLAYER_NAME] = playerName;
contentInfo[Conviva.Constants.VIEWER_ID] = viewerId;
contentInfo[Conviva.Constants.DURATION] = duration;
contentInfo[Conviva.Constants.ENCODED_FRAMERATE] = encodedFps;
contentInfo[Conviva.Constants.DEFAULT_RESOURCE] = defaultResource;
contentInfo[ANY_TAG_KEY1] = "VALUE1";
contentInfo[ANY_TAG_KEY2] = "VALUE2";

//Initialise the THEOplayer Conviva Plugin with the defined Content Info 
var integration = new NewConvivaIntegration(player,convivaConfigs,{ [Conviva.Constants.IS_LIVE]: Conviva.Constants.StreamType.VOD, contentInfo);

```

Note: `player` in the `NewConvivaIntegration` is THEOplayer Object initialised on the web page. 

## Related links:

- Demo page: [Conviva Analytics Test Page](https://cdn.theoplayer.com/conviva/conviva_test.html).
- [Conviva SDK Documentation](https://cdn.theoplayer.com/conviva/Conviva_Documentation_4.0.14/index.html)

## License

This projects falls under the license as defined in https://github.com/THEOplayer/license-and-disclaimer.

## Rationale

In order to use the SDK in a streaming pipeline, it needs to be integrated within an application.
During the development of these applications, developers need access to solid documentation and
examples at the risk of integrations not being of sufficient quality. As these applications are
developed by and owned by customers, it is not always possible for THEOplayer team to get insights
into the code. As a result, when issues occur during integration or when the app is in production,
it can be difficult to analyse where the issue is. Similarly, when issues occur in the integrated
code which are hard to reproduce, this is most often related to mistakes in the integration.


