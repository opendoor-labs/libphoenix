Libphoenix
==========

The [Phoenix Framework](https://phoenixframework.org) javascript library transpiled for node.

This module's version will always match as close as possible to the [Phoenix Framework](https://phoenixframework.org) version it is based off of.

How to Update
-------------
```
git clone --recursive git@github.com:opendoor-labs/libphoenix.git
cd libphoenix/phoenix/
git checkout v1.2.1 # update phoenix submodule
cp priv/static/phoenix.js ../libphoenix.js
```
remove the first and last lines:
```
(function(exports){
})(typeof(exports) === "undefined" ? window.Phoenix = window.Phoenix || {} : exports);
```
Bump version number to match in package.json
PR changes as "Update to 1.2.1"
