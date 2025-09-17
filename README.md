# PlayTable Motion Playground

Three.js, DeviceMotion/DeviceOrientation, WebSocket을 활용한 온라인 라켓 스포츠 게임 프로토타입의 스타터 키트입니다.

## 빠른 실행

```bash
bun install
bun run src/index.ts
```

서버가 `http://localhost:3000`에서 실행됩니다. 동일 네트워크 상의 모바일 기기에서 접근해 센서 기능을 테스트하세요.

## 제공 기능

- `Elysia` 서버가 정적 자산과 `/ws` WebSocket 엔드포인트를 제공합니다.
- `Three.js` 기반 코트, 네트, 라켓 모델이 미리 구성되어 있습니다.
- `DeviceMotion` · `DeviceOrientation` 이벤트를 수집해 라켓 회전 및 이동에 반영합니다.
- 센서 데이터는 WebSocket으로 브로드캐스트할 수 있도록 스켈레톤 헬퍼가 포함되어 있습니다.
- 데스크톱 테스트를 위해 마우스 드래그 시뮬레이션 입력을 지원합니다.

## 폴더 구조

- `src/index.ts` – Elysia 서버 및 정적 파일 서빙, WebSocket 브로커 기본 뼈대
- `public/index.html` – UI 스캐폴딩, 센서 활성화 버튼, 안내 문구
- `public/app.js` – Three.js 장면 구동, 센서 및 네트워크 초기화
- `public/game/GameScene.js` – 코트/라켓 렌더링과 입력 반영 로직
- `public/input/DeviceMotionController.js` – 센서 권한 요청 및 이벤트 래퍼
- `public/net/NetworkClient.js` – WebSocket 클라이언트, 자동 재연결 로직
- `public/styles.css` – 다크 테마 레이아웃 및 반응형 스타일

## 센서 사용 가이드

- **HTTPS/localhost 필수**: iOS Safari는 보안 환경에서만 자이로/가속도계 접근을 허용합니다.
- **사용자 제스처 필요**: iOS 계열에서는 반드시 버튼 탭 등 사용자 입력 뒤에 `requestPermission()`을 호출해야 합니다.
- **전송 간격 조절**: 기본 구현은 센서 데이터를 60~120ms로 제한해 전송합니다. 게임 로직에 맞춰 조정하세요.
- **배터리 고려**: 센서 이벤트 처리와 Three.js 렌더링은 배터리 사용량이 높으므로 필요 시 샘플링 레이트 조절을 권장합니다.

## 다음 단계 아이디어

1. WebSocket 메시지 라우팅을 확장해 다중 플레이어 동기화를 구현하세요.
2. 셔틀콕/볼 물리와 충돌 판정을 추가해 라켓 인터랙션을 완성하세요.
3. 플레이어 매칭, 룸 관리, 점수판 UI를 도입해 게임 구조를 잡아보세요.
4. PWA/모바일 최적화를 통해 가속도계 기반 UI를 자연스럽게 구성하세요.
