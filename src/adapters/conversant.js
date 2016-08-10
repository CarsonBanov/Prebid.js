'use strict';
var CONSTANTS = require('../constants.json');
var utils = require('../utils.js');
var bidfactory = require('../bidfactory.js');
var bidmanager = require('../bidmanager.js');
var allPlacementCodes;

/**
 * Adapter for requesting bids from Conversant
 */
var ConversantAdapter = function() {
  var bidsMap = {};
  var w = window;
  var n = navigator;
  var browser = detect();

  // production endpoint
  var conversantUrl = location.protocol + '//media.msg.dotomi.com/s2s/header';

  // SSAPI returns JSONP with window.pbjs.conversantResponse as the cb
  var appendScript = function (code){
    var script = document.createElement('script');
    script.type = 'text/javascript';
    script.className = 'cnvr-response';

    try {
      script.appendChild(document.createTextNode(code));
      document.body.appendChild(script);
    } catch (e) {
      script.text = code;
      document.body.appendChild(script);
    }
  };

  var httpPOSTAsync = function (url, data){
    var xmlHttp = new w.XMLHttpRequest();

    xmlHttp.onload = function() {
      appendScript(xmlHttp.responseText);
    };
    xmlHttp.open('POST', url, true); // true for asynchronous
    xmlHttp.send(data);
  };

  var getDNT = function(){
    return n.doNotTrack === "1" || w.doNotTrack === "1" || n.msDoNotTrack === "1" || n.doNotTrack === "yes";
  };

  var getDevice = function(){
    return {
      devicetype: (function(){
        if (browser.details.desktop){
          return 2;
        }
        else if (browser.details.mobile){
          return 4;
        }
        else if (browser.details.tablet){
          return 5;
        }
        return 6;
      }()),
      h: screen.height,
      w: screen.width,
      dnt: getDNT() ? 1 : 0,
      language: n.language.split('-')[0],
      make: n.vendor ? n.vendor : '',
      os: browser.details.os.name,
      osv: browser.details.os.version+'',
      ua: n.userAgent
    };
  };

  var callBids = function (params) {
    var conversantBids = params.bids || [];
    // De-dupe by tagid then issue single bid request for all bids
    requestBids(conversantBids);
  };

  var requestBids = function (bidReqs) {
    // build bid request object
    var page = location.pathname + location.search + location.hash;
    var siteId = '';
    var impCount = 1;
    var conversantImps = [];
    allPlacementCodes = [];

    //build impression array for conversant
    utils._each(bidReqs, function(bid) {
      var bidfloor = utils.getBidIdParamater('bidfloor', bid.params),
        sizeArrayLength = bid.sizes.length,
        adW = 0,
        adH = 0;

      siteId = utils.getBidIdParamater('site_id', bid.params);

      if (sizeArrayLength === 2 && typeof bid.sizes[0] === 'number' && typeof bid.sizes[1] === 'number') {
        adW = bid.sizes[0];
        adH = bid.sizes[1];
      } else {
        adW = bid.sizes[0][0];
        adH = bid.sizes[0][1];
      }
      var imp = {
        id: impCount.toString(),
        banner: {
          w: adW,
          h: adH
        },
        bidfloor: bidfloor ? bidfloor : 0,
        displaymanager: 'Prebid.js',
        displaymanagerver: '0.0.1'
      };

      conversantImps.push(imp);
      bidsMap[imp.id] = bid;
      allPlacementCodes.push(bid.placementCode);
      impCount++;
    });

    var conversantBidReqs = {
      'id': utils.getUniqueIdentifierStr(),
      'imp': conversantImps,

      'site': {
        'id': siteId,
        'mobile': document.querySelector('meta[name="viewport"][content*="width=device-width"]') !== null ? 1 : 0,
        'page': page
      },

      'device': getDevice(),
      'at': 1
    };

    httpPOSTAsync(conversantUrl, JSON.stringify(conversantBidReqs));
  };

  var addBlankBidResponsesForAllPlacementsExceptThese = function (placementsWithBidsBack) {
    utils._each(allPlacementCodes, function(placementCode) {
      if (!utils.contains(placementsWithBidsBack, placementCode)) {
        // Add a no-bid response for this placement.
        var bid = bidfactory.createBid(2);
        bid.bidderCode = 'conversant';
        bidmanager.addBidResponse(placementCode, bid);
      }
    });
  };

  var parseSeatbid = function(bidResponse){
    var placementsWithBidsBack = [];
    utils._each(bidResponse.bid, function (conversantBid){
      var responseCPM;
      var placementCode = '';
      var id = conversantBid.impid;
      var bid = {};

      // Bid request we sent Conversant
      var bidObj = bidsMap[id];
      if (bidObj) {
        placementCode = bidObj.placementCode;
        placementsWithBidsBack.push(placementCode);
        bidObj.status = CONSTANTS.STATUS.GOOD;

        // Register bid response with bidmanager
        responseCPM = parseFloat(conversantBid.price);

        if (responseCPM !== 0.0) {
          conversantBid.placementCode = placementCode;
          conversantBid.size = bidObj.sizes;
          var responseAd = conversantBid.adm || '';
          var responseNurl = conversantBid.nurl || '';

          // Our bid!
          bid = bidfactory.createBid(1);
          bid.creative_id = conversantBid.id || '';
          bid.bidderCode = 'conversant';

          bid.cpm = responseCPM;

          // Track impression image onto returned html and decode
          // Using bid.ad as the server returns HTML snippets.  Can also return url to ad in bid.adurl
          bid.ad =  responseAd + '<img src=\"' + responseNurl + '\" />';


          var sizeArrayLength = bidObj.sizes.length;
          if (sizeArrayLength === 2 && typeof bidObj.sizes[0] === 'number' && typeof bidObj.sizes[1] === 'number') {
            bid.width = bidObj.sizes[0];
            bid.height = bidObj.sizes[1];
          } else {
            bid.width = bidObj.sizes[0][0];
            bid.height = bidObj.sizes[0][1];
          }

          bidmanager.addBidResponse(placementCode, bid);

        } else {
          //0 price bid
          //indicate that there is no bid for this placement
          bid = bidfactory.createBid(2);
          bid.bidderCode = 'conversant';
          bidmanager.addBidResponse(placementCode, bid);

        }
      } else { // bid not found, we never asked for this?
        //no response data
        bid = bidfactory.createBid(2);
        bid.bidderCode = 'conversant';
        bidmanager.addBidResponse(placementCode, bid);
      }
    });
    addBlankBidResponsesForAllPlacementsExceptThese(placementsWithBidsBack);
  };

  // Register our callback to the global object:
  w.pbjs.conversantResponse = function(conversantResponseObj) {
    // valid object?
    if (conversantResponseObj && conversantResponseObj.id) {
      if (conversantResponseObj.seatbid && conversantResponseObj.seatbid.length > 0 && conversantResponseObj.seatbid[0].bid && conversantResponseObj.seatbid[0].bid.length > 0) {
        utils._each(conversantResponseObj.seatbid, parseSeatbid);
      } else {
        //no response data for any placements
        addBlankBidResponsesForAllPlacementsExceptThese([]);
      }
    } else {
      //no response data for any placements
      addBlankBidResponsesForAllPlacementsExceptThese([]);
    }
  }; // conversantResponse

  return {
    callBids: callBids
  };
};

/* This is a separator to keep the JSDOC from going insane */

var kindleBrowser = /Kindle|Silk|KFTT|KFOT|KFJWA|KFJWI|KFSOWI|KFTHWA|KFTHWI|KFAPWA|KFAPWI/i,
    DEFAULT_VERSION = -1,
    MAX = {
      EXCEED: 'ex',
      OK: 'ok'
    },
    LATEST = {
      FIREFOX: 51,
      CHROME: 55,
      EDGE: 14,
      OPERA: 40
    },
    TYPE = {
      MICROSOFT: 1,
      FIREFOX: 2,
      CHROME: 3,
      OPERA: 4,
      SAFARI: 5,
      ANDROID: 6,
      SAFARI_MOBILE: 7,
      OPERA_MINI: 8,
      OPERA_ANDROID: 9,
      CHROME_MOBILE: 10,
      MICROSOFT_MOBILE: 11,
      FIREFOX_MOBILE: 12,
      BLACKBERRY: 13,
      KINDLE: 14,
      WEBVIEW: 15,
      UNKNOWN: 16,
      UNKNOWN_MOBILE: 17
    };

var can = function (obj, propertyName) {
  return typeof obj[propertyName] !== 'undefined';
};

/**
 * Does this window have this object in it
 * @param globalObjectName
 * @param [scope] Optional scope to use. Alternatively, you can call "run" with a more sane method signature.
 * @returns {*}
 */
var has = function (globalObjectName, scope) {
  scope = scope || window;
  return can(scope, globalObjectName) ? scope[globalObjectName] : false;
};

/**
 * @returns {ua}
 * @constructor
 */
var Ua = function () {
  this.version = DEFAULT_VERSION;
};

/**
 * @returns {feature}
 * @constructor
 */
var Feature = function () {
  this.version = DEFAULT_VERSION;
};

/**
 * @returns {engine}
 * @constructor
 */
var Engine = function () {
  this.name = '';
  this.version = DEFAULT_VERSION;
};

/**
 * @returns {os}
 * @constructor
 */
var Os = function () {
  this.name = '';
  this.version = DEFAULT_VERSION + '';
};

/**
 *
 * @returns {browser}
 * @constructor
 */
var Browser = function () {
  var self = this; // here for minification purposes
  self.name = ''; // verified name
  self.trustworthy = true; // does the ua jive with the feature detection
  self.desktop = false; // is this a desktop browser
  self.mobile = false; // is this a mobile phone browser
  self.tablet = false; // is this a mobile tablet browser
  self.console = false; // is this a video game or other console browser
  self.max = MAX.OK; // by default the ua version matches what is available
  self.version = DEFAULT_VERSION; // full version
  self.ua = new Ua();
  self.feature = new Feature();
  self.engine = new Engine();
  self.os = new Os();
};

/**
 * Check for MathML support in browsers to help detect certain browser version numbers where this is the only difference
 * @param {Document} d
 * @returns {boolean}
 */
var mathMLSupport = function (d) {

  var hasMathML = false;

  if (d.createElementNS) {
    var NAMESPACE = 'http://www.w3.org/1998/Math/MathML',
        div = d.createElement('div'),
        mfrac;

    div.style.position = 'absolute';
    div.style.top = div.style.left = 0;
    div.style.visibility = 'hidden';
    div.style.width = div.style.height = 'auto';
    div.style.fontFamily = 'serif';
    div.style.lineheight = 'normal';

    mfrac = div.appendChild(d.createElementNS(NAMESPACE,'math'))
        .appendChild(d.createElementNS(NAMESPACE,'mfrac'));

    mfrac.appendChild(d.createElementNS(NAMESPACE,'mi'))
        .appendChild(d.createTextNode('xx'));

    mfrac.appendChild(d.createElementNS(NAMESPACE,'mi'))
        .appendChild(d.createTextNode('yy'));

    d.body.appendChild(div);

    hasMathML = div.offsetHeight > div.offsetWidth;
  }

  return hasMathML;
};

/**
 * Performs a simple test to see if we're on mobile or not
 * @param {Window=} win
 * @returns {boolean}
 */
var isMobile = function (win) {

  win = win || window;

  try {
    win.document.createEvent('TouchEvent');
    // Surface tablets have touch events, so we use the Pointer Lock API to detect them
    return !can(win.document, 'exitPointerLock') || !can(win.document, 'mozExitPointerLock');
  } catch (e) {
    // Opera Mini and IE10M don't support touch events
    // execCommand is only on desktop browsers
    return !can(win.document, 'execCommand');
  }
};



/**
 *
 * @param {number} uaVersion
 * @param {number} minVersion
 * @param {number=} maxVersion
 * @returns {number}
 */
var getVersion = function (uaVersion, minVersion, maxVersion) {
  var actualVersion = minVersion;
  if (uaVersion >= minVersion) {
    if (!maxVersion || uaVersion <= maxVersion) {
      actualVersion = uaVersion;
    } else if (maxVersion && uaVersion > maxVersion) {
      actualVersion = maxVersion;
    }
  }
  return actualVersion;
};

/**
 *
 * @param {RegExp} regex
 * @param {string} ua
 * @returns {*|boolean}
 */
var looksLike = function (regex, ua) {
  return regex.test(ua);
};

/**
 * Parses the result of the RegExp match if it exists
 * Gracefully falls back to the default version if not
 * @param {string} ua
 * @param {RegExp} regex
 * @param {number=} radix
 * @returns {number}
 */
var parseIntIfMatch = function (ua, regex, radix) {
  return ua.match(regex) !== null ? parseInt(ua.match(regex)[1], radix || 10) : DEFAULT_VERSION;
};

/**
 * Parses the floating point value of the RegExp match if found
 * Gracefully falls back to the default if not
 * @param {string} ua
 * @param {RegExp} regex
 * @returns {number}
 */
var parseFloatIfMatch = function (ua, regex) {
  return ua.match(regex) !== null ? parseFloat(ua.match(regex)[1]) : DEFAULT_VERSION;
};

/**
 *
 * @param {Window} win
 * @param {number} uaVersion
 * @returns {number}
 */
var getAndroidVersion = function (win, uaVersion) {

  var nav = win.navigator,
      androidVersion = DEFAULT_VERSION;

  if (can(nav, 'sendBeacon')) {
    androidVersion = getVersion(uaVersion, 5.0, Infinity);
  } else if (can(has('performance', win), 'now')) {
    androidVersion = getVersion(uaVersion, 4.4);
  } else if (has('FileList', win)) {
    androidVersion = getVersion(uaVersion, 4.0, 4.3);
  } else {
    androidVersion = getVersion(uaVersion, 2.1, 4.0);
  }

  return androidVersion;
};

/**
 *
 * @param {Window} win
 * @param {number} uaVersion
 * @returns {number}
 */
var getChromiumVersion = function (win, uaVersion) {

  var chromiumVersion = DEFAULT_VERSION;
  if (has('Proxy', win)) {
    chromiumVersion = getVersion(uaVersion, 49, LATEST.CHROME);
  } else if (has('PushManager', win)) {
    chromiumVersion = getVersion(uaVersion, 44, 48);
  } else if (can(win.navigator, 'permissions')) {
    chromiumVersion = getVersion(uaVersion, 43);
  } else if (can(win.navigator, 'sendBeacon')) {
    chromiumVersion = getVersion(uaVersion, 39, 42);
  } else if (can(win.navigator, 'getBattery')) {
    chromiumVersion = getVersion(uaVersion, 38);
  } else if (can(has('crypto', win), 'subtle')) {
    chromiumVersion = getVersion(uaVersion, 37);
  } else if (can(new Image(), 'srcset')) { // Chrome 34+
    chromiumVersion = getVersion(uaVersion, 34, 36);
  } else if (can(win.document, 'visibilityState')) { // Chrome 33+
    chromiumVersion = getVersion(uaVersion, 33);
  } else if (has('Promise', win)) { // Chrome 32+
    chromiumVersion = getVersion(uaVersion, 32);
  } else if (can(win.navigator, 'vibrate')) { // Chrome 30+
    chromiumVersion = getVersion(uaVersion, 30, 31);
  } else if (has('MutationObserver', win)) { // Chrome 27+
    chromiumVersion = getVersion(uaVersion, 27, 29);
  } else if (can(win.document.createElement('template'), 'content')) { // Chrome 26+
    chromiumVersion = getVersion(uaVersion, 26);
  } else if (can(has('performance', win), 'mark')) { // Chrome 25+
    chromiumVersion = getVersion(uaVersion, 25);
  } else if (has('requestAnimationFrame', win)) { // Chrome 24+
    chromiumVersion = getVersion(uaVersion, 24);
  } else if (can(has('URL', win), 'createObjectURL')) { // Chrome 23+
    chromiumVersion = getVersion(uaVersion, 23);
  } else if (has('Notification', win)) { // Chrome 22+
    chromiumVersion = getVersion(uaVersion, 22);
  } else if (can(win.navigator, 'webkitGetUserMedia')) { // Chrome 21+
    chromiumVersion = getVersion(uaVersion, 21);
  } else if (has('Blob', win)) { // Chrome 20+
    chromiumVersion = getVersion(uaVersion, 20);
  } else if (can(win.document, 'webkitRequestFullscreen')) { // Chrome 15+
    chromiumVersion = getVersion(uaVersion, 15, 19);
  } else if (can(has('performance', win), 'timing')) { // Chrome 13+
    chromiumVersion = getVersion(uaVersion, 13, 14);
  } else if (can(win.document.createElement('details'), 'open')) { // Chrome 12+
    chromiumVersion = getVersion(uaVersion, 12);
  } else if (has('webkitIndexedDB', win)) { // Chrome 11+
    chromiumVersion = getVersion(uaVersion, 11);
  } else if (can(win.document.createElement('input'), 'checkValidity')) { // Chrome 10+
    chromiumVersion = getVersion(uaVersion, 10);
  } else if (has('matchMedia', win)) { // Chrome 9+
    chromiumVersion = getVersion(uaVersion, 9);
  } else if (can(win.document.createElement('_'), 'classList')) { // Chrome 8+
    chromiumVersion = getVersion(uaVersion, 8);
  } else if (has('Uint32Array', win)) { // Chrome 7+
    chromiumVersion = getVersion(uaVersion, 7);
  } else if (has('FileReader', win)) { // Chrome 6+
    chromiumVersion = getVersion(uaVersion, 6);
  } else if (has('webkitNotification', win)) { // Chrome 5+
    chromiumVersion = getVersion(uaVersion, 5);
  } else if (can(has('history', win), 'replaceState')) { // Chrome 4+
    chromiumVersion = getVersion(uaVersion, 4);
  } else {
    chromiumVersion = getVersion(uaVersion, 0, 3);
  }
  return chromiumVersion;
};

/**
 *
 * @param {Window} win
 * @param {number} uaVersion
 * @returns {number}
 */
var getGeckoVersion = function (win, uaVersion) {

  var geckoVersion = DEFAULT_VERSION,
      d = win.document,
      nav = win.navigator;

  if (has('PushManager', win)) {
    geckoVersion = getVersion(uaVersion, 44, LATEST.FIREFOX);
  } else if (has('MessageChannel', win)) {
    geckoVersion = getVersion(uaVersion, 41, 43);
  } else if (has('fetch', win)) {
    geckoVersion = getVersion(uaVersion, 39, 40);
  } else if (can(has('performance', win), 'mark')) {
    geckoVersion = getVersion(uaVersion, 38);
  } else if (can(has('crypto', win), 'subtle')) {
    geckoVersion = getVersion(uaVersion, 34, 37);
  } else if (can(win.navigator, 'sendBeacon')) {
    geckoVersion = getVersion(uaVersion, 31, 33);
  } else if (has('SharedWorker', win)) { // FF 29+
    geckoVersion = getVersion(uaVersion, 29, 30);
  } else if (has('AudioContext', win)) { // FF 25+
    geckoVersion = getVersion(uaVersion, 25, 28);
  } else if (has('requestAnimationFrame', win)) { // FF 23+
    geckoVersion = getVersion(uaVersion, 23, 24);
  } else if (has('Notification', win)) { // FF 22+
    geckoVersion = getVersion(uaVersion, 22);
  } else if (can(d, 'hidden')) { // FF 18+
    geckoVersion = getVersion(uaVersion, 18, 21);
  } else if (can(nav, 'mozGetUserMedia')) { // FF 17+
    geckoVersion = getVersion(uaVersion, 17);
  } else if (has('indexedDB', win)) { // FF 16+
    geckoVersion = getVersion(uaVersion, 16);
  } else if (can(has('performance', win), 'now')) { // FF 15+
    geckoVersion = getVersion(uaVersion, 15);
  } else if (has('MutationObserver', win)) { // FF 14+
    geckoVersion = getVersion(uaVersion, 14);
  } else if (has('Blob', win)) { // FF 13+
    geckoVersion = getVersion(uaVersion, 13);
  } else if (has('WebSocket', win)) { // FF 11+
    geckoVersion = getVersion(uaVersion, 11, 12);
  } else if (can(nav, 'mozBattery')) { // FF 10+
    geckoVersion = getVersion(uaVersion, 10);
  } else if (can(has('performance', win), 'timing')) { // FF 7+
    geckoVersion = getVersion(uaVersion, 7, 9);
  } else if (has('matchMedia', win)) { // FF 6+
    geckoVersion = getVersion(uaVersion, 6);
  } else if (has('Uint32Array', win)) { // FF 4+
    geckoVersion = getVersion(uaVersion, 4, 5);
  } else if (has('FileReader', win)) { // FF 3.6
    geckoVersion = getVersion(uaVersion, 3.6);
  } else if (has('JSON', win)) { // FF 3.5+
    geckoVersion = getVersion(uaVersion, 3.5);
  } else if (has('postMessage', win)) { // FF 3+
    geckoVersion = getVersion(uaVersion, 3);
  } else {
    geckoVersion = getVersion(uaVersion, 0, 2.9);
  }

  return geckoVersion;
};

/**
 *
 * @param {Window} win
 * @param {number} uaVersion
 * @returns {number}
 */
var getTridentVersion = function (win, uaVersion) {

  var tridentVersion = DEFAULT_VERSION,
      d = win.document;

  if (can(d, 'pointerLockElement')) {
    tridentVersion = getVersion(uaVersion, 13, LATEST.EDGE);
  } else if (has('Proxy', win)) {
    tridentVersion = getVersion(uaVersion, 12);
  } else if (has('MutationObserver', win)) { // IE 11+
    tridentVersion = getVersion(uaVersion, 11);
  } else if (has('atob', win)) { // IE 10+
    tridentVersion = getVersion(uaVersion, 10);
  } else if (has('addEventListener', win)) { // IE 9+
    tridentVersion = getVersion(uaVersion, 9);
  } else if (has('localStorage', win)) { // IE 8+
    tridentVersion = getVersion(uaVersion, 8);
  } else if (can(d, 'all') && has('XMLHttpRequest', win) && !has('XDomainRequest', win) && !has('opera', win)) { // IE 7
    tridentVersion = getVersion(uaVersion, 7);
  } else if (can(d, 'all') && !has('XMLHttpRequest', win)) { // IE 6
    tridentVersion = getVersion(uaVersion, 6);
  } else { // IE 3 - 5.5
    tridentVersion = DEFAULT_VERSION;
  }

  return tridentVersion;
};

/**
 * See https://en.wikipedia.org/wiki/Trident_(layout_engine)
 * @param {number} ver
 * @returns {number}
 */
var getTridentEngineVersion = function (ver) {

  var engineVersion = DEFAULT_VERSION;

  if (ver >= 11) {
    engineVersion = 7;
  } else if (ver === 10) {
    engineVersion = 6;
  } else if (ver === 9) {
    engineVersion = 5;
  } else if (ver === 8) {
    engineVersion = 4;
  } else if (ver <= 7) {
    engineVersion = 3;
  }

  return engineVersion;
};

/**
 *
 * @param {Window} win
 * @param {number} uaVersion
 * @returns {number}
 */
var getSafariVersion = function (win, uaVersion) {

  var safariVersion = DEFAULT_VERSION,
      d = win.document,
      nav = win.navigator;

  if (can(has('CSS', win), 'supports')) {
    safariVersion = getVersion(uaVersion, 9.0, Infinity);
  } else if (has('indexedDB', win)) {
    safariVersion = getVersion(uaVersion, 8.0, 8.4);
  } else if (has('execCommand', d)) {
    safariVersion = getVersion(uaVersion, 7.0, 7.1);
  } else if (has('requestAnimationFrame', win)) {
    safariVersion = getVersion(uaVersion, 6.0, 6.1);
  } else if (has('Uint32Array', win)) {
    // Safari 6533.18.5 - iOS 4.3.5
    safariVersion = getVersion(uaVersion, 5.1);
  } else if (can(nav, 'geolocation')) {
    safariVersion = getVersion(uaVersion, 5.0);
  } else if (can(nav, 'onLine')) {
    safariVersion = getVersion(uaVersion, 4.2, 4.3);
  } else if (has('JSON', win)) {
    // Safari 6531.22.7 - iOS 4.0.2
    safariVersion = getVersion(uaVersion, 4.0, 4.1);
  } else if (has('postMessage', win)) {
    // webkit 531.21.10 - iOS 3.2.2
    // webkit 528.16 - iOS 3.1.3
    safariVersion = getVersion(uaVersion, 3.2);
  } else {
    safariVersion = getVersion(uaVersion, 0, 3.1);
  }

  return safariVersion;
};

/**
 *
 * @param {Window} win
 * @param {number} uaVersion
 * @returns {number}
 */
var getKindleVersion = function (win, uaVersion) {

  var kindleVersion = DEFAULT_VERSION,
      d = win.document;

  if (can(d, 'pointerLockElement')) {
    kindleVersion = getVersion(uaVersion, 3.0, Infinity);
  } else if (has('PerformanceTiming', win)) {
    kindleVersion = getVersion(uaVersion, 2.0);
  } else {
    kindleVersion = getVersion(uaVersion, 1.0);
  }

  return kindleVersion;
};

/**
 *
 * @param {Window} win
 * @param {string} ua
 * @returns {Browser}
 */
var getOtherOS = function (win, ua) {

  var otherBrowser = new Browser();

  if (has('wiiu', win)) {
    otherBrowser.os.name = 'Wii';
    otherBrowser.os.version = 'U';
    otherBrowser.name = 'NetFront';
    otherBrowser.console = true;
  } else if (looksLike(/Wii/i, ua)) {
    otherBrowser.os.name = 'Wii';
    otherBrowser.name = 'NetFront';
    otherBrowser.console = true;
  } else if (looksLike(/PlayStation.4/i, ua)) {
    otherBrowser.os.name = 'PlayStation';
    otherBrowser.os.version = '4';
    otherBrowser.name = 'NetFront';
    otherBrowser.console = true;
  } else if (looksLike(/PlayStation/i, ua)) {
    otherBrowser.os.name = 'PlayStation';
    otherBrowser.os.version = '3';
    otherBrowser.console = true;
  } else if (looksLike(/NgetOtherOSokiaN/i, ua)) {
    otherBrowser.os.name = 'Symbian';
    otherBrowser.mobile = true;
  } else if (looksLike(/blackberry|RIM/i, ua)) {
    otherBrowser.os.name = 'Blackberry';
    otherBrowser.mobile = true;
  } else if (win.navigator && win.navigator.platform === 'X11' || looksLike(/Linux/i, ua)) {
    otherBrowser.os.name = 'Linux';
    otherBrowser.desktop = true;
  } else {
    otherBrowser.os.name = 'Unknown';
  }
  return otherBrowser;
};

/**
 *
 * @param {Window} win
 * @param {string} ua
 * @returns {Browser}
 */
var getAppleOS = function (win, ua) {

  var mac = /Mac/i,
      iOS = /iPhone|iPad|iPod/i,
      appleBrowser = new Browser(),
      iOSVersion = DEFAULT_VERSION,
      macVersion = DEFAULT_VERSION;

  // Mozilla/5.0 (iPhone; CPU iPhone OS 7_1 like Mac OS X) AppleWebKit/537.51.2 (KHTML, like Gecko) Version/7.0 Mobile/11D167 Safari/9537.53
  // webviews will not have Safari in their user-agent string
  if ((iOS.test(ua) || iOS.test(win.navigator.platform)) || !looksLike(/Safari|Firefox|Chrome/i, ua)) {
    if (!looksLike(/Version\/\d\.\d/i, ua)) {
      appleBrowser.ua.version = '2.0';
    } else {
      if (looksLike(/.OS.(\d.\d+)/i, ua)) {
        iOSVersion = (ua.match(/.OS.(\d.\d+)/i)[1].replace('_','.'));
      } else if (looksLike(/.Version\/(\d\.\d+)/i, ua)) {
        iOSVersion = (ua.match(/.Version\/(\d\.\d+)/i)[1]);
      }
    }
    appleBrowser.ua.version = appleBrowser.os.version = iOSVersion;
    appleBrowser.os.name = 'iOS';
    appleBrowser.tablet = /ipad/i.test(win.navigator.platform);
    appleBrowser.mobile = /iphone|ipod/i.test(win.navigator.platform);
  } else if (mac.test(ua) || mac.test(win.navigator.platform)) {
    macVersion = parseIntIfMatch(ua, /Mac.OS.X.10.(\d+)/i, 10); // this format was introduced at 3.0+
    if (macVersion > 0) {
      appleBrowser.os.name = 'Mac';
      appleBrowser.os.version = '10.' + macVersion;
    }
    appleBrowser.desktop = true;
  }

  return appleBrowser;
};

/**
 *
 * @param {Window} win
 * @param {string} ua
 * @returns {Browser}
 */
var getMicrosoftOS = function (win, ua) {

  var microsoftBrowser = new Browser();

  if (looksLike(/XBox One/i, ua)) {
    microsoftBrowser.os.name = 'Xbox';
    microsoftBrowser.os.version = 'One';
    microsoftBrowser.name = 'Internet Explorer';
    microsoftBrowser.version = '10.0';
    microsoftBrowser.console = true;
  } else if (looksLike(/Xbox/i, ua)) {
    microsoftBrowser.os.name = 'Xbox';
    microsoftBrowser.os.version = '360';
    microsoftBrowser.name = 'Internet Explorer';
    microsoftBrowser.version = '7.0';
    microsoftBrowser.console = true;
  } else {
    microsoftBrowser.os.name = 'Windows';
    if (looksLike(/IEMobile/i, ua)) {
      microsoftBrowser.mobile = true;
      microsoftBrowser.os.name = 'Windows Phone';
      if (looksLike(/Windows.Phone.(?:os)?\s?(\d\d?\.?\d?\d?)/i, ua)) {
        microsoftBrowser.os.version = ua.match(/Windows.Phone.(?:os)?\s?(\d\d?\.?\d?\d?)/i)[1];
      } else if (looksLike(/WP(\d\d?\.?\d?\d?)/i, ua)) {
        microsoftBrowser.os.version = ua.match(/WP(\d\d?\.?\d?\d?)/i)[1];
      }
    } else if (looksLike(/Windows.NT./i, ua)) {
      microsoftBrowser.desktop = true;
      var pcVersion = parseFloatIfMatch(ua, /Windows.NT.(\d\d?\.?\d?\d?)/i); // this format was introduced at 3.0+
      // List pulled from http://msdn.microsoft.com/en-us/library/ms537503(v=vs.85).aspx
      switch (pcVersion) {
        case 10:
          microsoftBrowser.os.version = '10.0';
          break;
        case 6.3:
          microsoftBrowser.os.version = '8.1';
          break;
        case 6.2:
          microsoftBrowser.os.version = '8';
          break;
        case 6.1:
          microsoftBrowser.os.version = '7';
          break;
        case 6:
          microsoftBrowser.os.version = 'Vista';
          break;
        case 5.2:
          microsoftBrowser.os.version = '2003';
          break;
        case 5.1:
          microsoftBrowser.os.version = 'XP';
          break;
        case 5.01:
          microsoftBrowser.os.version = '2000 SP1';
          break;
        case 5:
          microsoftBrowser.os.version = '2000';
          break;
        case 4:
          microsoftBrowser.os.version = 'NT';
          break;
        default:
          microsoftBrowser.os.version = DEFAULT_VERSION;
      }
    } else if (looksLike(/Windows.9(\d)/i, ua)) {
      microsoftBrowser.os.version = '9x'; // 95, 98, or Me, which all must have a market share of nothingness by now so we dont care which it is
      microsoftBrowser.desktop = true;
    } else if (looksLike(/Windows.CE/i, ua)) {
      microsoftBrowser.os.version = 'CE'; // only matters that its mobile
      microsoftBrowser.mobile = true;
    } else {
      microsoftBrowser.os.version = DEFAULT_VERSION;
      microsoftBrowser.desktop = true;
    }
  }
  // special detection for MS Surfaces specifically
  if(looksLike(/Touch/i, ua) && !looksLike(/IEMobile/i, ua)) {
    microsoftBrowser.os.name = 'Window RT';
  }

  return microsoftBrowser;
};

/**
 *
 * @param {Window} win
 * @param {string} ua
 * @returns {Browser}
 */
var getAndroidOS = function (win, ua) {

  var androidBrowser = new Browser();

  androidBrowser.ua.version = parseFloatIfMatch(ua, /Android\s(\d+\.\d+)/i);
  androidBrowser.os.name = 'Android';
  androidBrowser.mobile = true;

  if (looksLike(/Chrome/i, ua)) {
    // modern Android browsers use the chrome engine
    androidBrowser.engine.name = 'chrome';
    androidBrowser.engine.version = parseIntIfMatch(ua, /Chrome\/(\d+)/i, 10);
  } else if (looksLike(/AppleWebKit/i, ua)) {
    // old Android browsers uses webkit
    androidBrowser.engine.name = 'webkit';
    androidBrowser.engine.version = parseIntIfMatch(ua, /AppleWebKit\/(\d+)/i, 10);
  } else {
    androidBrowser.engine.name = 'unknown';
  }
  // for now, we use the same logic for Android's browser and os detection
  androidBrowser.os.version = getAndroidVersion(win, androidBrowser.ua.version);

  return androidBrowser;
};

/**
 *
 * @param {Window} win
 * @param {string} ua
 * @returns {Browser}
 */
var getKindleOS = function (win, ua) {

  var kindleBrowser = new Browser();

  if (looksLike(/Silk/i, ua)) {
    kindleBrowser.engine.name = 'silk';
    kindleBrowser.engine.version = parseIntIfMatch(ua, /Silk\/(\d+)/i, 10);
    // set the detected version equal to silk by default
    kindleBrowser.ua.verison = kindleBrowser.engine.version;
  } else if (looksLike(/AppleWebKit/i, ua)) {
    kindleBrowser.engine.name = 'webkit';
    kindleBrowser.engine.version = parseIntIfMatch(ua, /AppleWebKit\/(\d+)/i, 10);
    // if the kindle doesn't have silk in the userAgent, something is wonky
    kindleBrowser.ua.version = 1;
  }

  if (looksLike(/Version/i, ua)) {
    // some kindles have a Version property in their userAgent
    kindleBrowser.ua.version = parseFloatIfMatch(ua, /Version\/(\d+\.\d+)/i);
  }

  kindleBrowser.version = getKindleVersion(win, kindleBrowser.ua.version);
  kindleBrowser.tablet = true;

  return kindleBrowser;
};

/**
 *
 * @param {Window} win
 * @param  {string} ua
 * @returns {Browser}
 */
var getOsFromUa = function (win, ua) {

  var unknownOS = new Browser();

  if (looksLike(/Win|IEMobile/i, ua)) {
    unknownOS = getMicrosoftOS(win, ua);
  } else if (looksLike(/Mac|iPhone|iPad|iPod/i, ua)) {
    unknownOS = getAppleOS(win, ua);
  } else if (looksLike(/Android/i, ua)) {
    unknownOS = getAndroidOS(win, ua);
  } else if (looksLike(kindleBrowser, ua)) {
    unknownOS = getKindleOS(win, ua);
  } else {
    unknownOS = getOtherOS(win, ua);
  }
  return unknownOS;
};

var detect = function (win, userAgent) {

  var detectedBrowser = new Browser(),
      browserType = '',
      w = win || window,
      d = w.document,
      ua = userAgent || w.navigator.userAgent,
      nav = w.navigator,
      style = w.document.documentElement.style;

  // see if this is a mobile browser
  detectedBrowser.mobile = isMobile(w);

  // run thru mobile detection first if applicable
  if (detectedBrowser.mobile) {
    // MS Surfaces pass the mobile test, so we account for them here
    // IE Mobile sometimes contain touch in the UA
    if (looksLike(/Win/i, ua) && looksLike(/Touch/i, ua) && !looksLike(/IEMobile/i, ua)) {
      browserType = TYPE.MICROSOFT;
      // Kindle feature support varies greatly, and they retain low market-share, so we trust the user agent for now
    } else if (looksLike(kindleBrowser, ua)) {
      browserType = TYPE.KINDLE;
    } else if (can(nav, 'permissions')) {
      // Chrome is the only mobile platform with permissions
      browserType = TYPE.CHROME_MOBILE;
    } else if (has('ondevicelight', w)) {
      // Only FF Mobile has the ambient light API
      browserType = TYPE.FIREFOX_MOBILE;
    } else if (has('setImmediate', w)) {
      // IE is the only mobile with setImmediate
      browserType = TYPE.MICROSOFT_MOBILE;
    } else if (!has('matchMedia', w)) {
      // only Opera Mini lacks matchMedia, thanks for making this easy Opera!
      browserType = TYPE.OPERA_MINI;
    } else if (has('speechSynthesis', w) && !has('Intl', w)) {
      // iOS has never supported the Intl api
      // iOS Safari has speech synth support that goes way back to older versions too
      browserType = TYPE.SAFARI_MOBILE;
    } else if (has('isFinite', w) || can(has('connection', nav), 'type')) {
      // Android is the only remaining one with isFinite
      // Very old Android supports nav.connection.type
      if (mathMLSupport(d)) {
        // Detect mathML to find webviews reporting themselves as Android
        browserType = TYPE.WEBVIEW;
      } else {
        // Android has never supported mathML as of 4.4.4
        browserType = TYPE.ANDROID;
      }
    } else if (!has('Intl', w)) {
      // blackBerry is the only one left without Internationalization
      browserType = TYPE.BLACKBERRY;
    } else if (has('webkitRequestFileSystem', w)) {
      // Opera is the only one remaining with a File System API
      browserType = TYPE.OPERA_ANDROID;
    } else {
      browserType = TYPE.UNKNOWN_MOBILE;
    }
  } else if (!has('Notification', w) && (!has('EventSource', w) && can(nav, 'onLine')) ) {
    browserType = TYPE.MICROSOFT;
  } else if (has('InstallTrigger', w)) {
    browserType = TYPE.FIREFOX;
  } else if (has('chrome', w) && !has('opera', w) && !looksLike(/\sOPR\/\d+/i, ua)) {
    browserType = TYPE.CHROME;
  } else if (has('opera', w) || looksLike(/\sOPR\/\d+/i, ua)) {
    browserType = TYPE.OPERA;
  } else if (!has('webkitRequestFileSystem', w) && !has('Intl', w)) {
    browserType = TYPE.SAFARI;
  } else {
    browserType = TYPE.UNKNOWN;
  }

  // now that we know the environment, we run feature detection specific to it
  if (browserType === TYPE.MICROSOFT) {

    detectedBrowser = getMicrosoftOS(w, ua);
    detectedBrowser.engine.name = 'trident';
    detectedBrowser.ua.version = parseIntIfMatch(ua, /Edge\/(\d+)/i, 10);

    if (detectedBrowser.ua.version === DEFAULT_VERSION) {
      detectedBrowser.ua.version = parseIntIfMatch(ua, /MSIE\/(\d+)/i, 10);
    }

    detectedBrowser.version = getTridentVersion(w, detectedBrowser.ua.version);
    detectedBrowser.engine.version = getTridentEngineVersion(detectedBrowser.version);

    if (detectedBrowser.version >= 12) {
      detectedBrowser.name = 'Edge';
    } else {
      detectedBrowser.name = 'Internet Explorer';
    }

    if (detectedBrowser.name === 'Edge' && !looksLike(/Edge/i, ua)) {
      detectedBrowser.trustworthy = false;
    } else if (detectedBrowser.name === 'Internet Explorer' && (!looksLike(/MSIE/i, ua) && !looksLike(/Trident/i, ua))) {
      detectedBrowser.trustworthy = false;
    }

  } else if (browserType === TYPE.FIREFOX) {

    detectedBrowser = getOsFromUa(w, ua);
    detectedBrowser.name = 'Firefox';
    detectedBrowser.engine.name = 'gecko';
    detectedBrowser.engine.version = parseIntIfMatch(ua, /rv:(\d+)/i, 10);
    detectedBrowser.ua.version = parseIntIfMatch(ua, /Firefox\/(\d+)/i, 10);
    detectedBrowser.version = getGeckoVersion(w, detectedBrowser.ua.version);

    if (!looksLike(/Firefox/i, ua)) { detectedBrowser.trustworthy = false; }

  } else if (browserType === TYPE.CHROME) {
    // Detect all chrome versions possible by feature detection

    // all versions:            1-38
    // optimal version coverage:      21, 35, 36, 37, 38
    // versions accounted for:        4-38
    // versions covered by feature testing: 4-13, 15, 20-27, 30, 32-34
    detectedBrowser = getOsFromUa(w, ua);
    detectedBrowser.engine.name = has('CSS', w) ? 'blink' : 'webkit'; // should be all of version 27+ on blink
    // chrome uses a standard ua format and can always supported indexOf
    detectedBrowser.engine.version = parseIntIfMatch(ua, /Chrome\/(\d+)/i, 10);
    detectedBrowser.ua.version = detectedBrowser.engine.version;
    detectedBrowser.version = getChromiumVersion(w, detectedBrowser.ua.version);

    detectedBrowser.name = 'Chrome';

    if (!looksLike(/Chrome/i, ua)) { detectedBrowser.trustworthy = false; }

  } else if (browserType === TYPE.OPERA) {
    detectedBrowser = getOsFromUa(w, ua);

    if (looksLike(/Presto\/(\d+\.\d+)/i, ua)) {
      detectedBrowser.engine.version = parseFloatIfMatch(ua, /Presto\/(\d+\.\d+)/i);
    } else if (looksLike(/AppleWebKit\/(\d+)/i, ua)) {
      detectedBrowser.engine.version = parseIntIfMatch(ua, /AppleWebKit\/(\d+)/i, 10);
    }

    if (looksLike(/Nintendo/i, ua)) {
      detectedBrowser.engine.name = 'presto';
      detectedBrowser.version = '9.0';
      detectedBrowser.console = true;
    } else {
      if (can(has('opera', w), 'version')) {
        detectedBrowser.feature.version = parseFloat(w.opera.version()); // presto reveals its version via api
        detectedBrowser.version = detectedBrowser.feature.version;
        detectedBrowser.engine.name = 'presto'; // should be all of version 27+ on blink
      } else {
        detectedBrowser.version = getChromiumVersion(w, detectedBrowser.ua.version);
        detectedBrowser.engine.name = 'blink'; // chrome's blink engine would be the version of the engine here
        detectedBrowser.engine.version = detectedBrowser.version; // chrome's blink engine would be the version of the engine here

        if (looksLike(/OPR\/\d+.\d+/i, ua)) {
          detectedBrowser.ua.version = parseFloatIfMatch(ua, /OPR\/\d+.\d+/i);
        }

        if (detectedBrowser.version >= 28) { // chrome version is 28+ then it's on chrome's release cycle.
          detectedBrowser.version = getVersion(detectedBrowser.ua.version, detectedBrowser.version - 13, LATEST.OPERA); // Guess the version based on chrome's version.
        }
      }
    }

    detectedBrowser.name = 'Opera';

    if (!looksLike(/Opera/i, ua)) { detectedBrowser.trustworthy = false; }

  } else if (browserType === TYPE.SAFARI) {
    detectedBrowser = getOsFromUa(w, ua);
    detectedBrowser.engine.version = parseIntIfMatch(ua, /AppleWebKit\/(\d+)/, 10);
    // all versions:            0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 2.0, 3.0, 3.1, 3.2, 4.0, 4.1, 5.0, 5.1, 6.0, 6.1, 7.0, 8.0
    // optimal version coverage:      6.1, 7.0, 8.0
    // versions accounted for:        *
    // versions covered by feature testing: 3.2, 4.0, 4.2, 5.0, 6.0, 7.0
    detectedBrowser.desktop = true;

    if (looksLike(/Version\/(\d\.\d)/i, ua)) {
      detectedBrowser.ua.version = parseFloatIfMatch(ua, /Version\/(\d\.\d)/i); // this format was introduced at 3.0+browser.ua.version = parseFloat(ua.match()[1]);
    }

    if (looksLike(/Mac.OS.X.10.(\d+)/i, ua)) {
      var macVersion = parseIntIfMatch(ua, /Mac.OS.X.10.(\d+)/i, 10); // this format was introduced at 3.0+
      if (macVersion > 0) {
        detectedBrowser.os.name = 'Mac';
        detectedBrowser.os.version = '10.' + macVersion;
      } else {
        detectedBrowser = getOsFromUa(w, ua);
      }
    } else {
      detectedBrowser = getOsFromUa(w, ua);
    }

    detectedBrowser.name = 'Safari';
    detectedBrowser.engine.name = 'webkit';
    detectedBrowser.version = getSafariVersion(w, detectedBrowser.ua.version);

    if (!looksLike(/Safari/i, ua)) {
      detectedBrowser.trustworthy = false;
    }

  } else if (browserType === TYPE.ANDROID) {

    detectedBrowser = getAndroidOS(w, ua);
    detectedBrowser.name = 'Android';
    detectedBrowser.version = getAndroidVersion(w, detectedBrowser.ua.version);

    if (!looksLike(/Android/i, ua) || !looksLike(/Mobile/i, ua)) { detectedBrowser.trustworthy = false; }

  } else if (browserType === TYPE.SAFARI_MOBILE) {

    detectedBrowser = getAppleOS(w, ua);
    // Feature detect Mobile Safari so we can tell if it's the real deal or an imposter
    detectedBrowser.name = 'Mobile Safari';
    detectedBrowser.engine.name  = 'webkit';
    detectedBrowser.engine.version = parseIntIfMatch(ua, /AppleWebKit\/(\d+)/, 10);
    if (looksLike(/Version\/(\d\.\d)/i, ua)) {
      detectedBrowser.ua.version = parseFloatIfMatch(ua, /Version\/(\d\.\d)/i); // this format was introduced at 3.0+browser.ua.version = parseFloat(ua.match()[1]);
    }
    // all versions:            1.0, 1.1, 2.0, 2.1, 2.2, 3.0, 3.1, 3.2, 4.0, 4.1, 4.2, 4.3, 5.0, 5.1, 6.0, 6.1, 7.0, 7.1, 8.0
    // optimal version coverage:      6.x, 7.x, 8.x
    // versions accounted for:        *
    // versions covered by feature testing: 3.2, 4.0, 4.2, 5.0, 6.0, 7.0, 8.0
    detectedBrowser.version = getSafariVersion(w, detectedBrowser.ua.version);
    detectedBrowser.os.version = detectedBrowser.version;

    if (!looksLike(/Safari/i, ua) || !looksLike(/iPhone|iPad/i, ua)) { detectedBrowser.trustworthy = false; }

  } else if (browserType === TYPE.CHROME_MOBILE) {
    detectedBrowser = getOsFromUa(w, ua);
    detectedBrowser.name = 'Chrome Android';
    detectedBrowser.ua.version = parseIntIfMatch(ua, /Chrome\/(\d+)/i, 10); // we trust the UA for now
    detectedBrowser.version = detectedBrowser.ua.version;
    if (!looksLike(/Chrome/i, ua) || !looksLike(/Mobile/i, ua)) { detectedBrowser.trustworthy = false; }

  } else if (browserType === TYPE.FIREFOX_MOBILE) {
    detectedBrowser = getOsFromUa(w, ua);
    detectedBrowser.name = 'Firefox Android';
    detectedBrowser.ua.version = parseIntIfMatch(ua, /Firefox\/(\d+)/i, 10); // we trust the UA for now
    detectedBrowser.version = detectedBrowser.ua.version;
    if (!looksLike(/Firefox/i, ua) || !looksLike(/Mobile/i, ua)) { detectedBrowser.trustworthy = false; }

  } else if (browserType === TYPE.MICROSOFT_MOBILE) {
    detectedBrowser = getMicrosoftOS(w, ua);
    detectedBrowser.name = 'Mobile IE';
    detectedBrowser.ua.version = parseIntIfMatch(ua, /IEMobile\/(\d+)/i, 10); // we trust the UA for now
    detectedBrowser.version = detectedBrowser.ua.version;
    if (!looksLike(/MSIE/i, ua) || !looksLike(/IEMobile/i, ua)) { detectedBrowser.trustworthy = false; }

  } else if (browserType === TYPE.WEBVIEW) {
    detectedBrowser = getAppleOS(w, ua);
    detectedBrowser.name = 'iOS Webview';
    if (!looksLike(/iPhone|iPad|iPod/i, ua) || !looksLike(/Mobile/i, ua)) { detectedBrowser.trustworthy = false; }
  } else if (browserType === TYPE.OPERA_MINI) {
    detectedBrowser = getOsFromUa(w, ua);
    detectedBrowser.name = 'Opera Mini';
    detectedBrowser.ua.version = parseIntIfMatch(ua, /Opera Mini\/(\d+)/i, 10); // we trust the UA for now
    detectedBrowser.version = detectedBrowser.ua.version;
    if (!looksLike(/Opera/i, ua) || !looksLike(/Mini/i, ua)) { detectedBrowser.trustworthy = false; }

  } else if (browserType === TYPE.OPERA_ANDROID) {
    detectedBrowser = getOsFromUa(w, ua);
    detectedBrowser.name = 'Opera Android';
    detectedBrowser.ua.version = parseIntIfMatch(ua, /Opera\/(\d+)/i, 10); // we trust the UA for now
    detectedBrowser.version = detectedBrowser.ua.version;
    if (!looksLike(/Opera/i, ua) || !looksLike(/Android/i, ua)) { detectedBrowser.trustworthy = false; }

  } else if (browserType === TYPE.KINDLE) {
    detectedBrowser = getKindleOS(w, ua);
    detectedBrowser.name = 'Kindle';
    // we rely on the user agent for all kindle detection, so we can't detect untrustworthiness
  } else if (browserType === TYPE.UNKNOWN || browserType === TYPE.UNKNOWN_MOBILE) {
    if (can(style, 'KhtmlUserInput')) {
      detectedBrowser.name = 'Linux Browser';
      detectedBrowser.engine.name = 'khtml';
      detectedBrowser.os.name = 'Linux';
      detectedBrowser.desktop = true;
    } else {
      detectedBrowser = getOsFromUa(w, ua);
      detectedBrowser.name = 'Unknown';
      detectedBrowser.engine.name = 'Unknown';
      detectedBrowser.os.name = 'Unknown';
    }
  }

  // if the user agent version is beyond
  if (detectedBrowser.ua.version > detectedBrowser.version) {
    detectedBrowser.max = MAX.EXCEED;
  }

  detectedBrowser.isIE = (detectedBrowser.name === 'Internet Explorer');
  detectedBrowser.isFF = (detectedBrowser.name === 'Firefox');
  detectedBrowser.isOpera = (detectedBrowser.name === 'Opera');
  detectedBrowser.isChrome = (detectedBrowser.name === 'Chrome');
  detectedBrowser.isSafari = (detectedBrowser.name === 'Safari');


  return {
    details: detectedBrowser
  };
};

module.exports = ConversantAdapter;
