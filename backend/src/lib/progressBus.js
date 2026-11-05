import { EventEmitter } from 'events';

const emitter = new EventEmitter();
emitter.setMaxListeners(1000);

const channels = new Map();

function channelFor(name) {
  if (!channels.has(name)) channels.set(name, new Set());
  return channels.get(name);
}

export const publishProgress = (channel, payload) => {
  const listeners = channels.get(channel);
  if (listeners) {
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch {
        // ignore listener errors
      }
    }
  }
  // Always emit on the global emitter too, for global SSE channels.
  emitter.emit('progress', { channel, payload });
};

export const subscribeProgress = (channel, listener) => {
  const listeners = channelFor(channel);
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const onAnyProgress = (listener) => {
  emitter.on('progress', listener);
  return () => emitter.off('progress', listener);
};