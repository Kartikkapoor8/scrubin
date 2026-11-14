/**
 * The app's end of the phone remote (see server/remote.mjs): commands arrive from phones on the network
 * through the local server, and the app reports where the procedure is so the phone can show it.
 */
export interface RemoteActions {
  next(): void;
  back(): void;
  reset(): void;
  talk(down: boolean): void;
}

export interface RemoteState {
  title: string;
  index: string;
  sutures: string;
  attending: string;
}

export function connectRemote(actions: RemoteActions, read: () => RemoteState, onPhones: (count: number) => void): void {
  let socket: WebSocket | null = null;
  let sent = '';

  const open = () => {
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/app`);
    socket.onopen = () => { sent = ''; };
    socket.onmessage = (event) => {
      let message: { t?: string; on?: boolean; count?: number };
      try { message = JSON.parse(String(event.data)); } catch { return; }
      switch (message.t) {
        case 'next': actions.next(); break;
        case 'back': actions.back(); break;
        case 'reset': actions.reset(); break;
        case 'talk': actions.talk(message.on === true); break;
        case 'phones': onPhones(message.count ?? 0); break;
      }
    };
    socket.onclose = () => {
      socket = null;
      window.setTimeout(open, 2000);
    };
  };
  open();

  // Tell the phones where we are, whenever it changes.
  window.setInterval(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const state = JSON.stringify({ t: 'state', ...read() });
    if (state !== sent) {
      sent = state;
      socket.send(state);
    }
  }, 300);
}
