var superagentLegacyIESupportPlugin = function (superagent) {

    // a litle cheat to parse the url, to find the hostname.
    function parseUrl(url) {
        var anchor = document.createElement('a');
        anchor.href = url;

        return {
            hostname: anchor.hostname,
            protocol: anchor.protocol,
            pathname: anchor.pathname,
            queryString: anchor.search
        };
    };

    // needed to copy this from Superagent library unfortunately
    function serializeObject(obj) {
        if (obj !== Object(obj)) return obj;
        var pairs = [];
        for (var key in obj) {
            if (null != obj[key]) {
                pairs.push(encodeURIComponent(key)
                  + '=' + encodeURIComponent(obj[key]));
            }
        }
        return pairs.join('&');
    }

    // the overridden end function to use for IE 8 & 9
    var xDomainRequestEnd = function (fn) {
        var self = this;
        var xhr = this.xhr = new XDomainRequest(); // IE 8 & 9 bespoke implementation
        
        // XDomainRequest doesn't support these, so we stub them out
        xhr.getAllResponseHeaders = function () { return ''; }; 
        xhr.getResponseHeader = function (name) {
            if (name == 'content-type') {
                return 'application/json'; // careful! you might not be able to make this cheating assumption.
            }
        };

        var query = this._query.join('&');
        var data = this._formData || this._data;

        // store callback
        this._callback = fn || noop;

        // state change
        xhr.onload = function () {
            xhr.status = 200;
            self.emit('end'); // assuming its always a 'readyState' of 4.
        };

        xhr.onerror = function () {
            xhr.status = 400;
            if (self.aborted) return self.timeoutError();
            return self.crossDomainError();
        };

        // progress
        xhr.onprogress = function () {
            self.emit('progress', 50);
        };

        // timeout
        xhr.ontimeout = function () {
            xhr.status = 408;
            return self.timeoutError();
        };

        // querystring
        if (query) {
            query = serializeObject(query);
            this.url += ~this.url.indexOf('?')
                ? '&' + query
                : '?' + query;
        }

        if (this.method != 'GET' && this.method != 'POST') {
            throw 'Only Get and Post methods are supported by XDomainRequest object.';
        }

        // initiate request
        xhr.open(this.method, this.url, true);

        // CORS - withCredentials not supported by XDomainRequest

        // body - remember only POST and GETs are supported
        if ('POST' == this.method && 'string' != typeof data) {
            data = serializeObject(data);
        }

        // custom headers are not support by XDomainRequest

        // send stuff
        this.emit('request', this);
        xhr.send(data);
        return this;
    };

    /**
     * Overrides .end() to use XDomainRequest object when necessary (making a cross domain request on IE 8 & 9.
     */

    // if request to other domain, and we're on a relevant browser
    var parsedUrl = parseUrl(superagent.url);
    if (parsedUrl.hostname != window.location.hostname &&
        typeof XDomainRequest !== "undefined") { // IE 8 & 9
        // (note another XDomainRequest restriction - calls must always be to the same protocol as the current page.)
        superagent.end = xDomainRequestEnd;
    }

};

module.exports = superagentLegacyIESupportPlugin;
