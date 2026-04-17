import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

interface ClaudeSession {
  process: ChildProcess;
  emitter: EventEmitter;
}

const sessions = new Map<string, ClaudeSession>();

export function startSession(cardId: string, cwd: string, prompt: string) {
  if (sessions.has(cardId)) {
    throw new Error('Session already running for this card');
  }

  const proc = spawn('claude', ['--output-format', 'stream-json'], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const emitter = new EventEmitter();
  sessions.set(cardId, { process: proc, emitter });

  let buffer = '';

  proc.stdout?.on('data', (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) {
        try {
          const parsed = JSON.parse(line);
          emitter.emit('message', parsed);
        } catch {
          emitter.emit('message', { type: 'raw', content: line });
        }
      }
    }
  });

  proc.stderr?.on('data', (data: Buffer) => {
    emitter.emit('message', { type: 'error', content: data.toString() });
  });

  proc.on('close', (code) => {
    emitter.emit('message', { type: 'close', code });
    emitter.emit('close');
    sessions.delete(cardId);
  });

  // Send the prompt to claude's stdin
  proc.stdin?.write(prompt + '\n');
}

export function sendInput(cardId: string, input: string) {
  const session = sessions.get(cardId);
  if (!session) throw new Error('No active session for this card');
  session.process.stdin?.write(input + '\n');
}

export function getEmitter(cardId: string): EventEmitter | undefined {
  return sessions.get(cardId)?.emitter;
}

export function killSession(cardId: string) {
  const session = sessions.get(cardId);
  if (session) {
    session.process.kill('SIGTERM');
    sessions.delete(cardId);
  }
}

export function hasSession(cardId: string): boolean {
  return sessions.has(cardId);
}
