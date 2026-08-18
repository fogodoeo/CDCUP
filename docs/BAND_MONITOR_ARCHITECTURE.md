# 밴드 경매 모니터 운영 구조

## 데이터 경계

- 활성 채널은 CREO 서버의 `operator-context` 응답으로 확정한다.
- CDCUP은 `legacy-cdcup` 어댑터만 사용한다.
- CREYON 등 공용 채널은 각 채널의 platform workspace만 사용한다.
- 활성 채널 확인이 실패하면 다른 저장소로 추측 전환하지 않는다.
- 화면에 목록을 불러온 채널과 저장 직전 활성 채널이 다르면 쓰기를 거부한다.

## 웹 런타임 단일화

- 운영 페이지의 단일 원본은 `https://creok.onrender.com`이다.
- 과거 `https://cdcup.onrender.com` 링크는 쿼리와 해시를 보존해 같은 CREOK 경로로 이동한다.
- 로컬 파일과 localhost에서는 리다이렉트하지 않아 오프라인 점검용 레거시 화면을 유지한다.
- 밴드 모니터의 기본 방송 URL도 CREOK 방송 페이지를 사용한다.

## 공통 계약

- `auction_contract.py`: 상태, 금액 단위, 체크리스트 메타데이터
- `platform_manager.py`: 채널 컨텍스트와 platform/legacy 어댑터 경계
- `capture_client.py`: 캡처 인증, 요청 payload, 재시도, 수동/종료 중복 규칙
- `supabase_manager.py`: CDCUP 레거시 저장소. 상태 해석은 공통 계약을 사용한다.

## 캡처 불변조건

- `capture_channel_id=auto`는 서버가 현재 활성 채널로 해석한다.
- 수동 캡처는 같은 개체의 기존 이미지를 교체할 수 있다.
- 종료 캡처는 이미 성공·대기 중인 수동 캡처가 있으면 건너뛴다.
- 네트워크 요청은 UI 스레드 밖에서 실행하고 최대 3회 재시도한다.

## 실행과 비밀값

- Python 3.13을 사용한다.
- `config.json`과 서비스 계정 JSON은 로컬 전용이며 Git에 올리지 않는다.
- 새 환경은 `config.example.json`을 복사해 비밀값을 직접 채운다.
- `requirements.txt`는 실제 검증한 버전으로 고정한다.

## 남은 레거시 부채

원본 GUI 코어 소스가 유실되어 현재 `band_monitor_app_core.pyc`를 동결 코어로 보관하고
`band_monitor_app.py`가 검증 가능한 소스 패치를 적용한다. 신규 기능은 코어에 덧대지 않고
위 공통 모듈로 분리한다. 장기적으로는 코어 화면을 소스 기반 모듈로 순차 교체해야 한다.

## 검증

```powershell
py -3.13 -m unittest -v test_auction_contract.py test_capture_client.py test_platform_manager.py test_supabase_manager.py test_desktop_architecture.py
py -3.13 -m py_compile auction_contract.py capture_client.py platform_manager.py supabase_manager.py band_monitor_app.py
```
