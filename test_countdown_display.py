import unittest
from countdown_display import CountdownDisplay


class DisplayTests(unittest.TestCase):
    def test_captured_channel_sequence_and_stop(self):
        sent = []
        p = CountdownDisplay(lambda *args: sent.append(args), autostart=False)
        p.set('one', 'a', True)
        p.publish()
        p.publish()
        p.set('', '', False)
        p.publish()
        self.assertEqual([r[0] for r in sent], ['one'] * 3)
        self.assertEqual([r[1]['sequence'] for r in sent], [1, 2, 3])
        self.assertEqual([r[1]['running'] for r in sent], [True, True, False])
        self.assertNotIn('name', sent[0][1])

    def test_latest_state_wins_and_failure_does_not_stop_auction(self):
        sent = []
        def send(*args):
            sent.append(args)
            raise RuntimeError('offline')
        p = CountdownDisplay(send, autostart=False)
        p.set('one', 'a', True)
        p.set('one', 'a', False)
        p.publish()
        self.assertFalse(sent[0][1]['running'])
        self.assertEqual(p.last_error, 'offline')

    def test_state_hook_tracks_running_only(self):
        import types
        import band_monitor_app as app
        seen = []
        publisher = types.SimpleNamespace(set=lambda *args: seen.append(args))
        host = types.SimpleNamespace(
            sheets=types.SimpleNamespace(using_platform=True, channel_id='one',
                                         publish_countdown_display=lambda *args: None),
            active_item={'row': 'a'}, _countdown_display_publisher=publisher)
        for state in [app.AUCTION_COUNTDOWN_RUNNING, app.AUCTION_COUNTDOWN_LOCK_PENDING,
                      app.AUCTION_COUNTDOWN_LOCKED, app.AUCTION_COUNTDOWN_IDLE]:
            app._core.MainWindow._set_auction_countdown_state(host, state)
        self.assertEqual([x[2] for x in seen], [True, False, False, False])
