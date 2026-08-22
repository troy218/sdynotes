# 엽스코드 통화 점검 기록

작성일: 2026-08-22

## 확인한 코드 경로

- 프론트 WebRTC: `sdynotes.html`
  - `/api/chat/config` ICE/STUN/TURN 설정 수신
  - `RTCPeerConnection` 생성
  - offer/answer/ICE candidate 시그널링
  - 직접 연결 실패 시 TURN relay 재시도
  - 연결 타임아웃 및 상태 표시
- 서버 시그널링: `server/src/routes/chat.js`
  - `/api/chat/config`
  - `/api/chat/voice`
  - `/api/chat/signal`
  - `/api/chat/stream`
  - `/api/chat/diag`
- 배포: `apply.sh`
  - coturn UDP/TCP 3478 설정
  - relay UDP 49160-49200 설정
  - `SDY_TURN_*` 환경변수 전달

## 실행한 테스트

### 1. Node 문법 검사

```bash
node --check server/src/routes/chat.js
node --check server/src/index.js
```

결과: 통과

실행 결과:

```text
채팅 테스트: PASS 18 / FAIL 0
```

세부적으로 입장, 메시지, 파일, SSE, 시그널 전달, offer 보류 큐, STUN 설정, TURN HMAC 인증, UDP/TCP 엔드포인트 분리, TTL 초기화를 확인했다.

### 2. 배포 스크립트 문법 검사

```bash
bash -n apply.sh
```

결과: 통과

### 3. 채팅 서버 핵심 API

Node 서버를 로컬 포트로 기동한 뒤 다음을 확인한다.

```bash
curl -s 'http://127.0.0.1:5000/api/chat/config?uid=test-client'
curl -s 'http://127.0.0.1:5000/api/chat/diag'
```

기대 결과:

- `/api/chat/config`: `ok:true`
- TURN이 설정된 경우: `turn:true`
- ICE 서버에 `stun:` 및 `turn:` 주소 포함
- `/api/chat/diag`: `localTcp`, `localUdp`, `localAlloc` 상태 확인 가능

### 4. 실제 서버에서 확인할 명령

```bash
sudo systemctl status coturn --no-pager
sudo ss -lunp | grep ':3478'
sudo ss -ltnp | grep ':3478'
curl -s http://127.0.0.1:5000/api/chat/diag
curl -s 'http://127.0.0.1:5000/api/chat/config?uid=diag-client'
```

외부 통화를 위해 Oracle VCN/NSG에도 다음을 허용해야 한다.

- UDP 3478
- TCP 3478
- UDP 49160-49200

## 이번 수정

기존 `apply.sh`가 이전 systemd 서비스의 `Environment=` 설정을 그대로 복사하고 있었다. 이 값은 `.env`보다 우선할 수 있어, 새 서버의 TURN IP/secret을 `.env`에 넣어도 오래된 TURN 설정으로 서비스가 실행될 수 있었다.

수정 후에는 `apply.sh`가 `/var/www/memo/.env`만 설정 기준으로 사용한다.

```bash
sudo bash apply.sh
```

배포 후 브라우저는 강력 새로고침한다.

```text
Ctrl + Shift + R
```

## 참고

이 저장소의 샌드박스에서는 실제 Oracle VCN 외부망과 두 개의 브라우저를 이용한 LTE↔Wi-Fi 통화까지는 측정할 수 없다. 최종 외부망 검증은 실제 서버의 `/api/chat/diag` 결과와 브라우저 `chrome://webrtc-internals`에서 `candidate-pair`가 `relay`로 연결되는지 확인해야 한다.
