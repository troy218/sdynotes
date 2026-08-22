// Server-push broker (SSE). Mirrors sdynotes/cloud.py `_publish_live`.
// Supabase is the durable store; SSE is a short-lived push layer. Clients
// fall back to polling when the stream drops.
const subs = new Set(); // Set<{queue, id}>

let seq = 0;

export function subscribe(queue) {
  subs.add(queue);
  return queue;
}

export function unsubscribe(queue) {
  subs.delete(queue);
}

// topic: 'settings' | 'notes' | 'cards' | 'stickers' | 'music' | ...
export function publishLive(topic, key = '') {
  const event = { topic: String(topic), key: String(key || ''), ts: Date.now() / 1000 };
  for (const q of subs) {
    if (q.length >= 64) {
      q.shift(); // drop oldest — a missed event is not data loss (pull APIs re-read)
    }
    q.push(event);
  }
}

export function nextSeq() {
  seq += 1;
  return seq;
}
