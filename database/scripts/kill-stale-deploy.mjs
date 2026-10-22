#!/usr/bin/env node
/**
 * Kill a deploy that wedged the machine.
 *
 * On 2026-10-22 a reconcile that failed hard (a SQL error) left its node
 * process alive: an open database handle keeps the event loop alive, so the
 * process never exited. Its parent deploy shell then waited on that child
 * forever, and the shell's EXIT trap (`rm -rf $LOCK_DIR`) means the moment it
 * unwound it would have deleted the lock directory of whatever deploy was
 * running NEXT - letting two builds race on the same tree.
 *
 * Killing the pair is the only clean exit: SIGKILL on the shell means the trap
 * never fires, and the orphan node goes with it.
 *
 * This never touches a process it cannot prove is the stale one. A target is
 * killed only when ALL of these hold:
 *   1. it is still alive,
 *   2. its command line contains the expected marker (a recycled pid never
 *      matches),
 *   3. it started at least --min-age-sec ago (a live deploy is seconds old),
 *   4. it is not this process, and not the shell that invoked this script.
 *
 * The shell that invoked a deploy is killed FIRST, so the orphaned node is
 * never re-parented into a running shell's trap.
 *
 * Usage:
 *   node database/scripts/kill-stale-deploy.mjs \
 *     --target=<pid>:<cmdline-marker> [--target=...] [--min-age-sec=600] [--apply]
 *
 * Without --apply it only reports what it would do.
 */

import { readFileSync } from 'node:fs';

const out = (line) => process.stdout.write(`${line}\n`);

const HZ = 100; // Linux default clock ticks per second for /proc stat values.

function argValues(name) {
  return process.argv
    .filter((a) => a.startsWith(`${name}=`))
    .map((a) => a.slice(name.length + 1));
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function readProc(pid, file) {
  try {
    return readFileSync(`/proc/${pid}/${file}`, 'utf-8');
  } catch {
    return null;
  }
}

/** Parse /proc/<pid>/stat: comm may contain spaces and parentheses, so split after the last ')'. */
function parseStat(pid) {
  const raw = readProc(pid, 'stat');
  if (!raw) return null;
  const close = raw.lastIndexOf(')');
  if (close < 0) return null;
  const fields = raw.slice(close + 1).trim().split(/\s+/);
  // fields[0] = state, fields[1] = ppid, ... fields[19] = starttime (ticks).
  const starttime = Number(fields[19]);
  const ppid = Number(fields[1]);
  if (!Number.isFinite(starttime) || !Number.isFinite(ppid)) return null;
  return { starttime, ppid };
}

function cmdline(pid) {
  const raw = readProc(pid, 'cmdline');
  if (raw === null) return null;
  return raw.split('\0').filter(Boolean).join(' ').trim();
}

function uptimeSeconds() {
  const raw = readProc(1, 'uptime');
  if (!raw) return null;
  const value = Number(raw.trim().split(/\s+/)[0]);
  return Number.isFinite(value) ? value : null;
}

const targets = argValues('--target');
const minAgeSec = Number(argValues('--min-age-sec')[0] ?? '600');
const apply = hasFlag('--apply');

if (targets.length === 0) {
  out('no --target given - nothing to do');
  process.exit(0);
}

const uptime = uptimeSeconds();
if (uptime === null) {
  out('FATAL: cannot read /proc/1/uptime - refusing to kill anything');
  process.exit(2);
}

const myPid = process.pid;
const parentPid = process.ppid;
const mine = new Set([myPid, parentPid]);

// The deploy shell must die first: its EXIT trap deletes the lock directory,
// and a node that outlives its parent would keep the shell waiting (or, worse,
// let the trap fire later). Everything matching "deploy.sh" goes first.
const ordered = [
  ...targets.filter((t) => t.includes(':deploy.sh')),
  ...targets.filter((t) => !t.includes(':deploy.sh')),
];

let killed = 0;
let skipped = 0;

for (const target of ordered) {
  const sep = target.indexOf(':');
  if (sep < 0) {
    out(`SKIPPED: malformed target "${target}" (expected <pid>:<marker>)`);
    skipped += 1;
    continue;
  }
  const pid = Number(target.slice(0, sep));
  const marker = target.slice(sep + 1);
  const label = `pid ${pid} (marker "${marker}")`;

  if (!Number.isInteger(pid) || pid <= 1) {
    out(`SKIPPED: ${label} - not a plausible pid`);
    skipped += 1;
    continue;
  }
  if (mine.has(pid)) {
    out(`SKIPPED: ${label} - that is this process or its parent`);
    skipped += 1;
    continue;
  }

  const stat = parseStat(pid);
  if (!stat) {
    out(`SKIPPED: ${label} - not running (or not readable)`);
    skipped += 1;
    continue;
  }

  const line = cmdline(pid);
  if (line === null || !line.includes(marker)) {
    out(`SKIPPED: ${label} - command line does not match the marker: ${line ?? '(unreadable)'}`);
    skipped += 1;
    continue;
  }

  const ageSec = uptime - stat.starttime / HZ;
  if (ageSec < minAgeSec) {
    out(`SKIPPED: ${label} - only ${ageSec.toFixed(0)}s old (a live deploy is younger than ${minAgeSec}s)`);
    skipped += 1;
    continue;
  }

  if (!apply) {
    out(`WOULD KILL: ${label} - age ${ageSec.toFixed(0)}s - ${line}`);
    continue;
  }

  try {
    process.kill(pid, 'SIGKILL');
    out(`KILLED: ${label} - age ${ageSec.toFixed(0)}s - ${line}`);
    killed += 1;
  } catch (error) {
    out(`FAILED to kill ${label}: ${error.message}`);
    skipped += 1;
  }
}

// Confirm the targets are gone.
if (apply) {
  for (const target of ordered) {
    const pid = Number(target.slice(0, target.indexOf(':')));
    if (!Number.isInteger(pid) || pid <= 1) continue;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const still = parseStat(pid);
      if (!still) break;
      if (attempt === 9) out(`WARNING: pid ${pid} is still alive after SIGKILL`);
      else await new Promise((r) => setTimeout(r, 200));
    }
  }
}

out(`done - killed ${killed}, skipped ${skipped}${apply ? '' : ' (dry run - pass --apply to kill)'}`);
process.exit(0);
