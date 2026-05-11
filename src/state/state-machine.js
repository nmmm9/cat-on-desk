const THRESHOLDS = {
  laptopLingerMs: 1000,
  walkAtMs: 10_000,
  walkDurationMs: 3000,
  walkCycleMs: 10_000,
  playStartMs: 60_000,
  sleepStartMs: 180_000,
};

const PLAY_BEHAVIOR_MS = 9000;

function pickRandom(arr, exclude = null) {
  if (!arr || arr.length === 0) return null;
  if (arr.length === 1) return arr[0];
  let idx = Math.floor(Math.random() * arr.length);
  if (arr[idx] === exclude) idx = (idx + 1) % arr.length;
  return arr[idx];
}

function createStateMachine({ playStates, sleepStates, onChange, resolveWalkDirection }) {
  let currentState = 'basic';
  let phase = 'idle';
  let phaseStartedAt = Date.now();
  let walkActive = false;
  let walkSlot = -1;
  let walkStartedAt = 0;
  let walkDirection = 1;
  let sleepLockedState = null;

  function setState(next, extra) {
    if (next === currentState && !extra) return;
    currentState = next;
    onChange?.({ state: currentState, phase, ...(extra || {}) });
  }

  function tick(idleMs) {
    const now = Date.now();

    // active
    if (idleMs < THRESHOLDS.laptopLingerMs) {
      if (walkActive || sleepLockedState) {
        walkActive = false;
        walkSlot = -1;
        sleepLockedState = null;
      }
      phase = 'active';
      phaseStartedAt = now;
      setState('laptop');
      return { state: currentState, phase, walkActive: false };
    }

    // sleep locked
    if (sleepLockedState) {
      phase = 'sleep';
      setState(sleepLockedState);
      return { state: currentState, phase, walkActive: false };
    }

    // sleep enter
    if (idleMs >= THRESHOLDS.sleepStartMs) {
      sleepLockedState = pickRandom(sleepStates) || 'basic';
      phase = 'sleep';
      phaseStartedAt = now;
      setState(sleepLockedState);
      return { state: currentState, phase, walkActive: false };
    }

    // walk windows: every walkCycleMs starting from walkAtMs, until playStartMs
    if (idleMs >= THRESHOLDS.walkAtMs && idleMs < THRESHOLDS.playStartMs) {
      const rel = idleMs - THRESHOLDS.walkAtMs;
      const slot = Math.floor(rel / THRESHOLDS.walkCycleMs);
      const within = rel - slot * THRESHOLDS.walkCycleMs;

      if (within < THRESHOLDS.walkDurationMs) {
        const newSlot = !walkActive || walkSlot !== slot;
        if (newSlot) {
          walkActive = true;
          walkSlot = slot;
          walkStartedAt = now;
          walkDirection = resolveWalkDirection
            ? resolveWalkDirection()
            : (Math.random() < 0.5 ? -1 : 1);
          phase = 'walk';
          setState('walk', { direction: walkDirection });
        } else {
          setState('walk');
        }
        return { state: currentState, phase: 'walk', walkActive: true, walkStartedAt, walkDirection };
      }

      // between walk slots
      if (walkActive) walkActive = false;
      phase = 'idle';
      setState('basic');
      return { state: currentState, phase, walkActive: false };
    }

    // play: 60s ~ 180s
    if (idleMs >= THRESHOLDS.playStartMs) {
      const elapsedInPhase = now - phaseStartedAt;
      const needRoll =
        phase !== 'play' ||
        !playStates.includes(currentState) ||
        elapsedInPhase >= PLAY_BEHAVIOR_MS;
      if (needRoll) {
        const next = pickRandom(playStates, currentState) || 'basic';
        phase = 'play';
        phaseStartedAt = now;
        setState(next);
      }
      return { state: currentState, phase, walkActive: false };
    }

    // 0 ~ walkAtMs (under 10s): basic
    phase = 'idle';
    setState('basic');
    return { state: currentState, phase, walkActive: false };
  }

  function syncState(state) {
    currentState = state;
    if (state === 'walk') {
      walkActive = false;
      walkSlot = -1;
    }
    sleepLockedState = null;
  }

  return {
    tick,
    syncState,
    getState: () => currentState,
    getPhase: () => phase,
  };
}

module.exports = { createStateMachine, THRESHOLDS };
