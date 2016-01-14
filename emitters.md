Emitters
====

What emits what

descriptor-stream
----
* `error`, with the error
* `connect`, with the connected descriptor (each of them as single event)
* `disconnect`, with the disconnected descriptor (each of them as single event)
* `acquired`, with the acquired descriptor (each of them as single event)
* `released`, with the released descriptor (each of them as single event)
* `changedSessions`, with the acquired/released descriptor
* `update`, with object where there is all of the before (all of them in one big event)


device-list
----
* `error`, with the error
* `transport`, with the transport, when the transport is successfully set up
* `connect`, with the Device, when it is successfully connected + acquired. Also when previously UnacquiredDevice is connected.
  * if the device was previously UnacquiredDevice, the UnacquiredDevice is the second argument. If it wasn't, the second argument is `undefined`.
* `connectUnacquired`, with the UnacquiredDevice, when it is successfully connected, but cannot be acquired
* `disconnect`, with either Device or UnacquiredDevice, when it is disconnected. *Not* emitted when unacquired device becomes acquired; only `connect` with the new Device is emitted in that case
* `update`, with any session update


device
---
* `error`, with error
* `disconnect`
* `changedSession`, with two arguments
  * first is whether the device is being used now
  * second is whether the current code is using the device
  * (if first is true, but the second is false, it means that someone else is using the device)
* `send`, before any message is sent to trezor
* `receive`, after any message is received to trezor
* `button`, when user is asked for an action on device
  * only argument is type of button, in the format `ButtonRequest_[type]` where `[type]` is one of the types [here](https://github.com/trezor/trezor-common/blob/master/protob/types.proto#L78-L89)
* `passphrase`, when the user is asked for passphrase
  * first argument is callback - a function, that expects two arguments
     * first argument is error - if there is no error, it should be null
     * second argument is the passphrase
* `pin`, when the user is asked for pin
  * first argument is type (different for first PIN on setup, different on actions)
     * TODO document somewhere
  * second argument is callback - a function, that expects two arguments
     * first argument is error - if there is no error, it should be null
     * second argument is the passphrase
* `word` in seed asking in device recovery
  * TODO document somewhere

unacquired-device
---
* `disconnect` when the device is disconnected before we had chance to acquire it once
* `acquire` when the device is acquired and initialized successfully
   * the first argument is the new Device
