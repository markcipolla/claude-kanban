import fs from 'fs';
import path from 'path';

const KANBAN_DIR = path.join(process.env.HOME || '~', '.kanban');
const CONFIG_PATH = path.join(KANBAN_DIR, 'config.json');
const CARDS_PATH = path.join(KANBAN_DIR, 'cards.json');

export interface Repo {
  id: string;
  path: string;
  name: string;
  org: string;
}

export interface Card {
  id: string;
  repoId: string;
  title: string;
  prompt: string;
  status: 'todo' | 'in_progress' | 'done';
  createdAt: string;
  prUrl?: string;
}

interface Config {
  repos: Repo[];
}

function ensureDir() {
  fs.mkdirSync(KANBAN_DIR, { recursive: true });
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, data: unknown) {
  ensureDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function getRepos(): Repo[] {
  return readJson<Config>(CONFIG_PATH, { repos: [] }).repos;
}

export function addRepo(repo: Repo) {
  const config = readJson<Config>(CONFIG_PATH, { repos: [] });
  config.repos.push(repo);
  writeJson(CONFIG_PATH, config);
}

export function removeRepo(id: string) {
  const config = readJson<Config>(CONFIG_PATH, { repos: [] });
  config.repos = config.repos.filter(r => r.id !== id);
  writeJson(CONFIG_PATH, config);
}

export function getCards(): Card[] {
  return readJson<Card[]>(CARDS_PATH, []);
}

export function getCard(id: string): Card | undefined {
  return getCards().find(c => c.id === id);
}

export function addCard(card: Card) {
  const cards = getCards();
  cards.push(card);
  writeJson(CARDS_PATH, cards);
}

export function updateCard(id: string, updates: Partial<Card>) {
  const cards = getCards();
  const idx = cards.findIndex(c => c.id === id);
  if (idx === -1) throw new Error('Card not found');
  cards[idx] = { ...cards[idx], ...updates };
  writeJson(CARDS_PATH, cards);
}

export function deleteCard(id: string) {
  const cards = getCards().filter(c => c.id !== id);
  writeJson(CARDS_PATH, cards);
}

export function getRepo(id: string): Repo | undefined {
  return getRepos().find(r => r.id === id);
}
