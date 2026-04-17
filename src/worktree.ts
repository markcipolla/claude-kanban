import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const WORKTREES_DIR = path.join(process.env.HOME || '~', '.kanban', 'worktrees');

export function getWorktreePath(org: string, repo: string, cardId: string): string {
  return path.join(WORKTREES_DIR, org, repo, cardId);
}

export function createWorktree(repoPath: string, org: string, repo: string, cardId: string): string {
  const wtPath = getWorktreePath(org, repo, cardId);
  fs.mkdirSync(path.dirname(wtPath), { recursive: true });
  const branch = `kanban/${cardId}`;
  execSync(`git -C "${repoPath}" worktree add "${wtPath}" -b "${branch}"`, { stdio: 'pipe' });
  return wtPath;
}

export function removeWorktree(repoPath: string, org: string, repo: string, cardId: string) {
  const wtPath = getWorktreePath(org, repo, cardId);
  const branch = `kanban/${cardId}`;
  try {
    execSync(`git -C "${repoPath}" worktree remove "${wtPath}" --force`, { stdio: 'pipe' });
  } catch { /* worktree may already be gone */ }
  try {
    execSync(`git -C "${repoPath}" branch -D "${branch}"`, { stdio: 'pipe' });
  } catch { /* branch may already be gone */ }
}

export function createPR(wtPath: string, title: string): string {
  try {
    execSync(`git -C "${wtPath}" add -A && git -C "${wtPath}" commit -m "kanban: ${title}" --allow-empty`, {
      stdio: 'pipe',
    });
  } catch { /* may have nothing to commit */ }
  execSync(`git -C "${wtPath}" push -u origin HEAD`, { stdio: 'pipe' });
  const result = execSync(`gh pr create --title "${title.replace(/"/g, '\\"')}" --body "Created via Claude Kanban" --head "$(git -C "${wtPath}" branch --show-current)"`, {
    cwd: wtPath,
    stdio: 'pipe',
  });
  return result.toString().trim();
}
