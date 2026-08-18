import json
import unittest

from platform_manager import ChannelAwareManager


class FakeResponse:
    def __init__(self, status, body):
        self.status_code = status
        self.ok = 200 <= status < 300
        self._body = body

    def json(self):
        return self._body


class FakeLegacy:
    def __init__(self):
        self.online = True
        self.read_count = 0
        self.ws = object()

    def read_items(self):
        self.read_count += 1
        return [{"row": 99, "name": "CDCUP legacy"}]

    def read_parents(self):
        return []

    def connect_write(self):
        return True

    def get_tab_list(self):
        return ["items"]

    def switch_tab(self, _name):
        return True


def context_request(channel_id, adapter, items=None):
    workspace = None if adapter == "legacy-cdcup" else {
        "items": items or [], "vendors": [], "shipments": [], "assets": [], "broadcast": {"id": "state"}
    }

    def request(method, url, **_kwargs):
        if url.endswith("/api/platform/operator-context"):
            return FakeResponse(200, {
                "activeChannelId": channel_id,
                "channel": {"id": channel_id, "name": channel_id.upper(), "dataAdapter": adapter},
                "adapter": adapter,
                "workspace": workspace
            })
        raise AssertionError(url)

    return request


class ChannelAwareManagerTests(unittest.TestCase):
    def test_verified_legacy_context_reads_only_legacy_rows(self):
        legacy = FakeLegacy()
        manager = ChannelAwareManager({"platform_admin_password": "test-secret"}, legacy=legacy, request_func=context_request("cdcup", "legacy-cdcup"))
        rows = manager.read_items()
        self.assertEqual(rows[0]["name"], "CDCUP legacy")
        self.assertEqual(legacy.read_count, 1)
        self.assertEqual(manager.backend_name, "Supabase · CDCUP")

    def test_verified_platform_context_maps_platform_rows(self):
        legacy = FakeLegacy()
        item = {"id": "one", "lotNumber": 1, "name": "CREYON item", "status": "live", "soldPrice": 0}
        manager = ChannelAwareManager({"platform_admin_password": "test-secret"}, legacy=legacy, request_func=context_request("creyon", "platform", [item]))
        rows = manager.read_items()
        self.assertEqual(rows[0]["row"], "one")
        self.assertEqual(rows[0]["status"], "진행중")
        self.assertEqual(legacy.read_count, 0)

    def test_initial_context_failure_exposes_no_legacy_rows(self):
        legacy = FakeLegacy()

        def failing_request(*_args, **_kwargs):
            raise RuntimeError("network unavailable")

        manager = ChannelAwareManager({"platform_admin_password": "test-secret"}, legacy=legacy, request_func=failing_request)
        self.assertEqual(manager.read_items(), [])
        self.assertEqual(legacy.read_count, 0)
        self.assertIn("연결 확인 필요", manager.backend_name)

    def test_transient_failure_keeps_last_platform_adapter_and_never_leaks_cdcup(self):
        legacy = FakeLegacy()
        state = {"fail": False}
        success = context_request("creyon", "platform", [{"id": "one", "lotNumber": 1, "name": "CREYON item"}])

        def request(*args, **kwargs):
            if state["fail"]:
                raise RuntimeError("temporary outage")
            return success(*args, **kwargs)

        manager = ChannelAwareManager({"platform_admin_password": "test-secret"}, legacy=legacy, request_func=request)
        self.assertTrue(manager.using_platform)
        state["fail"] = True
        self.assertEqual(manager.read_items(), [])
        self.assertTrue(manager.using_platform)
        self.assertEqual(manager.channel_id, "creyon")
        self.assertEqual(legacy.read_count, 0)

    def test_platform_channel_without_admin_secret_fails_closed_with_clear_state(self):
        legacy = FakeLegacy()

        def request(_method, url, **_kwargs):
            if url.endswith("/api/platform/active-channel"):
                return FakeResponse(200, {"channelId": "creyon"})
            if url.endswith("/api/platform/channels/creyon"):
                return FakeResponse(200, {"channel": {"id": "creyon", "name": "CREYON", "dataAdapter": "platform"}})
            raise AssertionError(url)

        manager = ChannelAwareManager({}, legacy=legacy, request_func=request)
        self.assertEqual(manager.read_items(), [])
        self.assertEqual(legacy.read_count, 0)
        self.assertIn("관리자 인증 필요", manager.backend_name)
        self.assertIn("관리자 비밀번호", manager.last_read_error)

    def test_external_channel_switch_cannot_write_a_stale_item_id_into_the_new_channel(self):
        legacy = FakeLegacy()
        state = {"channel": "alpha", "writes": []}
        workspaces = {
            "alpha": [{"id": "same-id", "lotNumber": 1, "name": "ALPHA item", "status": "waiting"}],
            "beta": [{"id": "same-id", "lotNumber": 1, "name": "BETA item", "status": "waiting"}],
        }

        def request(method, url, **kwargs):
            channel_id = state["channel"]
            if url.endswith("/api/platform/operator-context"):
                return FakeResponse(200, {
                    "activeChannelId": channel_id,
                    "channel": {"id": channel_id, "name": channel_id.upper(), "dataAdapter": "platform"},
                    "workspace": {"items": workspaces[channel_id]}
                })
            if method == "PUT":
                state["writes"].append((url, kwargs.get("json")))
                return FakeResponse(200, {"record": kwargs.get("json", {}).get("record", {})})
            raise AssertionError(url)

        manager = ChannelAwareManager({"platform_admin_password": "test-secret"}, legacy=legacy, request_func=request)
        self.assertEqual(manager.read_items()[0]["name"], "ALPHA item")
        state["channel"] = "beta"

        self.assertFalse(manager.update_item({"row": "same-id", "name": "should not cross channels"}))
        self.assertEqual(state["writes"], [])
        self.assertIn("채널이 변경", manager.last_write_error)

        self.assertEqual(manager.read_items()[0]["name"], "BETA item")
        self.assertTrue(manager.update_item({"row": "same-id", "name": "BETA updated"}))
        self.assertEqual(len(state["writes"]), 1)
        self.assertIn("/channels/beta/items/same-id", state["writes"][0][0])

    def test_platform_broadcast_config_update_is_scoped_to_verified_active_channel(self):
        calls = []

        def request(method, url, **kwargs):
            if url.endswith("/api/platform/operator-context"):
                return FakeResponse(200, {
                    "activeChannelId": "creyon",
                    "channel": {"id": "creyon", "name": "CREYON", "dataAdapter": "platform"},
                    "workspace": {"items": []}
                })
            if method == "PUT" and url.endswith("/api/platform/channels/creyon/broadcast-config"):
                calls.append(kwargs.get("json"))
                return FakeResponse(200, {"config": {"auction_animation_enabled": "0"}})
            raise AssertionError(url)

        manager = ChannelAwareManager({"platform_admin_password": "test-secret"}, legacy=FakeLegacy(), request_func=request)
        self.assertTrue(manager.update_broadcast_config({"auction_animation_enabled": "0"}))
        self.assertEqual(calls, [{"patch": {"auction_animation_enabled": "0"}}])


if __name__ == "__main__":
    unittest.main()
