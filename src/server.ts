import express from 'express';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { execSync } from 'child_process';
import * as store from './store';
import * as worktree from './worktree';
import * as claude from './claude';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- Repos ---

app.get('/api/repos', (_req, res) => {
  res.json(store.getRepos());
});

app.post('/api/repos', (req, res) => {
  const { path: repoPath } = req.body;
  if (!repoPath) return res.status(400).json({ error: 'path required' });

  try {
    const remoteUrl = execSync(`git -C "${repoPath}" remote get-url origin`, { stdio: 'pipe' }).toString().trim();
    // Parse org/name from remote URL (supports https and ssh)
    const match = remoteUrl.match(/[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
    if (!match) return res.status(400).json({ error: 'Cannot parse remote URL' });

    const repo: store.Repo = {
      id: uuid(),
      path: repoPath,
      org: match[1],
      name: match[2],
    };
    store.addRepo(repo);
    res.json(repo);
  } catch {
    res.status(400).json({ error: 'Not a valid git repo or no origin remote' });
  }
});

app.delete('/api/repos/:id', (req, res) => {
  store.removeRepo(req.params.id);
  res.json({ ok: true });
});

// --- Cards ---

app.get('/api/cards', (req, res) => {
  let cards = store.getCards();
  if (req.query.repoId) {
    cards = cards.filter(c => c.repoId === req.query.repoId);
  }
  // Add live session status
  const enriched = cards.map(c => ({
    ...c,
    hasSession: claude.hasSession(c.id),
  }));
  res.json(enriched);
});

app.post('/api/cards', (req, res) => {
  const { repoId, title, prompt } = req.body;
  if (!repoId || !title || !prompt) {
    return res.status(400).json({ error: 'repoId, title, and prompt required' });
  }
  const card: store.Card = {
    id: uuid(),
    repoId,
    title,
    prompt,
    status: 'todo',
    createdAt: new Date().toISOString(),
  };
  store.addCard(card);
  res.json(card);
});

app.delete('/api/cards/:id', (req, res) => {
  const card = store.getCard(req.params.id);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  claude.killSession(card.id);

  if (card.status === 'in_progress') {
    const repo = store.getRepo(card.repoId);
    if (repo) {
      worktree.removeWorktree(repo.path, repo.org, repo.name, card.id);
    }
  }

  store.deleteCard(card.id);
  res.json({ ok: true });
});

// --- Card Actions ---

app.post('/api/cards/:id/start', (req, res) => {
  const card = store.getCard(req.params.id);
  if (!card) return res.status(404).json({ error: 'Card not found' });
  if (card.status !== 'todo') return res.status(400).json({ error: 'Card must be in TODO status' });

  const repo = store.getRepo(card.repoId);
  if (!repo) return res.status(400).json({ error: 'Repo not found' });

  try {
    const wtPath = worktree.createWorktree(repo.path, repo.org, repo.name, card.id);
    store.updateCard(card.id, { status: 'in_progress' });
    claude.startSession(card.id, wtPath, card.prompt);
    res.json({ ok: true, worktreePath: wtPath });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cards/:id/input', (req, res) => {
  const { input } = req.body;
  if (!input) return res.status(400).json({ error: 'input required' });

  try {
    claude.sendInput(req.params.id, input);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/cards/:id/done', (req, res) => {
  const card = store.getCard(req.params.id);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  const repo = store.getRepo(card.repoId);
  if (!repo) return res.status(400).json({ error: 'Repo not found' });

  claude.killSession(card.id);

  try {
    const wtPath = worktree.getWorktreePath(repo.org, repo.name, card.id);
    const prUrl = worktree.createPR(wtPath, card.title);
    store.updateCard(card.id, { status: 'done', prUrl });
    res.json({ ok: true, prUrl });
  } catch (err: any) {
    // Still mark as done even if PR creation fails
    store.updateCard(card.id, { status: 'done' });
    res.json({ ok: true, error: err.message });
  }
});

// --- SSE Stream ---

app.get('/api/cards/:id/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const emitter = claude.getEmitter(req.params.id);
  if (!emitter) {
    res.write(`data: ${JSON.stringify({ type: 'error', content: 'No active session' })}\n\n`);
    res.end();
    return;
  }

  const onMessage = (msg: any) => {
    res.write(`data: ${JSON.stringify(msg)}\n\n`);
  };
  const onClose = () => {
    res.write(`data: ${JSON.stringify({ type: 'close' })}\n\n`);
    res.end();
  };

  emitter.on('message', onMessage);
  emitter.on('close', onClose);

  req.on('close', () => {
    emitter.off('message', onMessage);
    emitter.off('close', onClose);
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Claude Kanban running at http://localhost:${PORT}`);
});
