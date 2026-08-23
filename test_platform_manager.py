import json
import threading
import time
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

    def test_platform_read_keeps_broadcast_lifecycle_and_private_item_attributes(self):
        item = {
            "id": "sold-one",
            "lotNumber": 1,
            "name": "낙찰 개체",
            "status": "sold",
            "soldPrice": 10000,
            "attributes": {
                "bid_log": '[{"name":"민우","bidder_key":"member-1","amount":1}]',
                "crewart_roulette_status": "unused",
            },
        }
        request = context_request("crewart", "platform", [item])
        manager = ChannelAwareManager(
            {"platform_admin_password": "test-secret"},
            legacy=FakeLegacy(),
            request_func=request,
        )
        manager._context_workspace["broadcast"] = {
            "id": "state",
            "mode": "sold",
            "activeItemId": "sold-one",
        }

        rows = manager.read_items()

        self.assertEqual(manager.broadcast_state["activeItemId"], "sold-one")
        self.assertEqual(rows[0]["attributes"]["crewart_roulette_status"], "unused")
        self.assertEqual(rows[0]["bids"][0]["bidder_key"], "member-1")
        self.assertEqual(
            manager.get_cached_item("sold-one")["attributes"]["crewart_roulette_status"],
            "unused",
        )

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

    def test_monitor_item_creation_is_scoped_to_expected_active_channel(self):
        state = {"channel": "crewart", "creates": []}

        def request(method, url, **kwargs):
            if url.endswith("/api/platform/operator-context"):
                channel_id = state["channel"]
                return FakeResponse(200, {
                    "activeChannelId": channel_id,
                    "channel": {"id": channel_id, "name": channel_id.upper(), "dataAdapter": "platform"},
                    "workspace": {"items": []}
                })
            if method == "POST" and url.endswith("/api/platform/channels/crewart/items"):
                state["creates"].append(kwargs.get("json"))
                record = {"id": "ite_new", **kwargs["json"]["record"]}
                return FakeResponse(201, {"record": record})
            raise AssertionError(url)

        manager = ChannelAwareManager(
            {"platform_admin_password": "test-secret"},
            legacy=FakeLegacy(),
            request_func=request,
        )
        self.assertTrue(manager.create_item({
            "num": 7, "company": "쭌이네", "name": "신규 개체", "price": 10,
            "status": "대기", "checklist": "sale_mode:buy_now",
        }, expected_channel_id="crewart"))
        self.assertEqual(len(state["creates"]), 1)
        self.assertTrue(state["creates"][0]["requireActiveChannel"])
        self.assertTrue(state["creates"][0]["allocateNextLot"])
        self.assertEqual(state["creates"][0]["record"]["startPrice"], 100000)
        self.assertEqual(state["creates"][0]["record"]["attributes"]["checklist"], "sale_mode:buy_now")

        state["channel"] = "creyon"
        self.assertFalse(manager.create_item(
            {"num": 8, "name": "다른 채널로 가면 안 됨", "price": 1},
            expected_channel_id="crewart",
        ))
        self.assertEqual(len(state["creates"]), 1)
        self.assertIn("채널이 변경", manager.last_write_error)

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

    def test_crewart_bid_assignment_uses_the_verified_channel_and_idempotency_fields(self):
        calls = []
        context_calls = []

        def request(method, url, **kwargs):
            if url.endswith("/api/platform/operator-context"):
                context_calls.append(url)
                return FakeResponse(200, {
                    "activeChannelId": "crewart",
                    "channel": {
                        "id": "crewart", "name": "CREWART", "dataAdapter": "platform",
                        "audienceCompetition": {
                            "enabled": True, "assignment": "survey-random", "metric": "soldPrice"
                        },
                    },
                    "workspace": {"items": []},
                })
            if method == "POST" and url.endswith("/api/platform/channels/crewart/audience-assignment"):
                calls.append(kwargs)
                return FakeResponse(200, {
                    "houseKey": "R", "source": "random", "isNewRandom": True, "revealSequence": 1
                })
            raise AssertionError(url)

        manager = ChannelAwareManager(
            {"platform_admin_password": "test-secret"},
            legacy=FakeLegacy(),
            request_func=request,
        )
        result = manager.resolve_audience_assignment(
            item_id="A01", bidder_key="band-member-key", name="김상정/대구/01012345678",
            amount=3, message_key="ws:member:1:3", bid_sequence=123,
        )

        self.assertEqual(result["houseKey"], "R")
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["timeout"], 3)
        self.assertEqual(calls[0]["json"]["message_key"], "ws:member:1:3")
        self.assertEqual(calls[0]["json"]["bid_sequence"], 123)
        self.assertEqual(calls[0]["json"]["bidder_key"], "band-member-key")
        self.assertEqual(len(context_calls), 1)

    def test_new_platform_channel_merges_staged_quick_edit_into_auction_start(self):
        writes = []
        item = {
            "id": "lot-1", "lotNumber": 1, "name": "초기 개체", "note": "",
            "status": "waiting", "attributes": {"checklist": "gender:U|weight:3"},
        }

        def request(method, url, **kwargs):
            if url.endswith("/api/platform/operator-context"):
                return FakeResponse(200, {
                    "activeChannelId": "new-channel",
                    "channel": {"id": "new-channel", "name": "NEW", "dataAdapter": "platform"},
                    "workspace": {"items": [item]},
                })
            if method == "PUT" and url.endswith("/auction-transition"):
                writes.append(kwargs["json"])
                return FakeResponse(200, {"item": kwargs["json"]["item"]})
            raise AssertionError(url)

        manager = ChannelAwareManager(
            {"platform_admin_password": "test-secret"}, legacy=FakeLegacy(), request_func=request
        )
        manager.read_items()
        self.assertTrue(manager.stage_item_update({
            "row": "lot-1", "name": "수정 개체", "note": "비고 유지",
            "checklist": "gender:M|weight:3",
        }))
        self.assertTrue(manager.update_item({"row": "lot-1", "status": "진행중"}))

        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0]["item"]["name"], "수정 개체")
        self.assertEqual(writes[0]["item"]["note"], "비고 유지")
        self.assertEqual(writes[0]["item"]["attributes"]["checklist"], "gender:M|weight:3")
        self.assertEqual(writes[0]["status"], "live")

    def test_quick_edit_and_start_writes_are_serialized_without_stale_field_restore(self):
        writes = []
        first_write_started = threading.Event()
        allow_first_write = threading.Event()
        item = {
            "id": "lot-1", "lotNumber": 1, "name": "개체", "note": "",
            "status": "waiting", "attributes": {"checklist": "gender:U"},
        }

        def request(method, url, **kwargs):
            if url.endswith("/api/platform/operator-context"):
                return FakeResponse(200, {
                    "activeChannelId": "new-channel",
                    "channel": {"id": "new-channel", "name": "NEW", "dataAdapter": "platform"},
                    "workspace": {"items": [item]},
                })
            if method == "PUT":
                payload = kwargs["json"]
                writes.append((url, payload))
                if len(writes) == 1:
                    first_write_started.set()
                    allow_first_write.wait(2)
                return FakeResponse(200, {
                    "item": payload.get("item"), "record": payload.get("record")
                })
            raise AssertionError(url)

        manager = ChannelAwareManager(
            {"platform_admin_password": "test-secret"}, legacy=FakeLegacy(), request_func=request
        )
        manager.read_items()
        manager.stage_item_update({"row": "lot-1", "note": "새 비고", "checklist": "gender:M"})

        edit_thread = threading.Thread(target=lambda: manager.update_item({
            "row": "lot-1", "note": "새 비고", "checklist": "gender:M"
        }))
        start_thread = threading.Thread(
            target=lambda: manager.update_item({"row": "lot-1", "status": "진행중"})
        )
        edit_thread.start()
        self.assertTrue(first_write_started.wait(1))
        start_thread.start()
        time.sleep(0.05)
        self.assertEqual(len(writes), 1)
        allow_first_write.set()
        edit_thread.join(2)
        start_thread.join(2)

        self.assertEqual(len(writes), 2)
        sent_records = [payload.get("record") or payload.get("item") for _url, payload in writes]
        self.assertTrue(all(record["note"] == "새 비고" for record in sent_records))
        self.assertTrue(all(record["attributes"]["checklist"] == "gender:M" for record in sent_records))

    def test_failed_quick_edit_write_keeps_the_draft_across_refresh_for_retry(self):
        item = {
            "id": "lot-1", "lotNumber": 1, "name": "개체", "note": "",
            "status": "waiting", "attributes": {"checklist": "gender:U"},
        }

        def request(method, url, **_kwargs):
            if url.endswith("/api/platform/operator-context"):
                return FakeResponse(200, {
                    "activeChannelId": "new-channel",
                    "channel": {"id": "new-channel", "name": "NEW", "dataAdapter": "platform"},
                    "workspace": {"items": [item]},
                })
            if method == "PUT":
                raise RuntimeError("temporary write failure")
            raise AssertionError(url)

        manager = ChannelAwareManager(
            {"platform_admin_password": "test-secret"}, legacy=FakeLegacy(), request_func=request
        )
        manager.read_items()
        manager.stage_item_update({"row": "lot-1", "note": "재시도 비고", "checklist": "gender:M"})
        self.assertFalse(manager.update_item({"row": "lot-1", "note": "재시도 비고", "checklist": "gender:M"}))

        refreshed = manager.read_items()[0]
        self.assertEqual(refreshed["note"], "재시도 비고")
        self.assertEqual(refreshed["checklist"], "gender:M")


if __name__ == "__main__":
    unittest.main()
