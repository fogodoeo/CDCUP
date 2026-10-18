"""Best-effort display lease; never changes auction/chat/countdown decisions."""
import threading
import uuid


class CountdownDisplay:
    def __init__(self, send, interval=5, autostart=True):
        self.send = send
        self.interval = interval
        self.session = str(uuid.uuid4())
        self.sequence = 0
        self.current = None
        self.lock = threading.Lock()
        self.wake = threading.Event()
        self.last_error = ""
        if autostart:
            threading.Thread(target=self._run, daemon=True).start()

    def set(self, channel_id, item_id, running):
        with self.lock:
            if not item_id and self.current:
                channel_id, item_id, _ = self.current
            if not channel_id or not item_id:
                return
            self.current = (channel_id, str(item_id), bool(running))
        self.wake.set()

    def publish(self):
        with self.lock:
            if not self.current:
                return
            channel, item, running = self.current
            self.sequence += 1
            payload = dict(sessionId=self.session, sequence=self.sequence,
                           itemId=item, running=running)
        try:
            self.send(channel, payload)
            self.last_error = ""
        except Exception as exc:
            self.last_error = str(exc)

    def _run(self):
        while True:
            with self.lock:
                running = bool(self.current and self.current[2])
            self.wake.wait(self.interval if running else None)
            self.wake.clear()
            self.publish()
