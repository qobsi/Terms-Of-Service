"use strict";

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

(() => {
  const reader = document.querySelector("#reading-surface");
  const popup = document.querySelector("#frame-popover");
  const links = [...document.querySelectorAll("[data-frame-info]")];
  const canHover = matchMedia("(hover: hover) and (pointer: fine)");
  let active = null;
  let pinned = false;
  let leaveTimer;
  let closeTimer;
  let moveTimer;
  let scrollScheduled = false;
  let returningFocus = false;

  const isOpen = () => popup.matches(":popover-open");
  const clearTimers = () => {
    clearTimeout(leaveTimer);
    clearTimeout(closeTimer);
    clearTimeout(moveTimer);
    popup.classList.remove("is-closing", "is-moving");
  };

  function position(link) {
    const rect = link.getBoundingClientRect();
    const margin = 16;
    const gap = 12;
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    const below = innerHeight - rect.bottom - margin - gap;
    const above = rect.top - margin - gap;
    const top =
      below >= height || below >= above
        ? rect.bottom + gap
        : rect.top - height - gap;
    popup.style.left = `${Math.round(Math.max(margin, Math.min(rect.left - 10, innerWidth - width - margin)))}px`;
    popup.style.top = `${Math.round(Math.max(margin, Math.min(top, innerHeight - height - margin)))}px`;
  }

  function setActive(link) {
    for (const item of links)
      item.setAttribute("aria-expanded", String(item === link));
  }

  function show(link, pin = false) {
    clearTimers();
    const moving =
      isOpen() && active && link !== active && !reducedMotion.matches;
    if (moving) popup.classList.add("is-moving");
    active = link;
    pinned = pin;
    if (!isOpen()) popup.showPopover();
    position(link);
    if (moving)
      moveTimer = setTimeout(() => popup.classList.remove("is-moving"), 250);
    setActive(link);
  }

  function close() {
    clearTimeout(leaveTimer);
    clearTimeout(moveTimer);
    popup.classList.remove("is-moving");
    if (!isOpen() || popup.classList.contains("is-closing")) return;
    pinned = false;
    setActive(null);
    if (reducedMotion.matches) {
      popup.hidePopover();
      active = null;
      return;
    }
    popup.classList.add("is-closing");
    closeTimer = setTimeout(() => {
      popup.hidePopover();
      popup.classList.remove("is-closing");
      active = null;
    }, 150);
  }

  function maybeClose() {
    if (pinned) return;
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      if (
        pinned ||
        popup.contains(document.activeElement) ||
        popup.matches(":hover") ||
        links.some((link) => link.matches(":hover"))
      )
        return;
      close();
    }, 145);
  }

  for (const link of links) {
    link.addEventListener("pointerenter", () => {
      if (canHover.matches && !pinned) show(link);
    });
    link.addEventListener("pointerleave", () => {
      if (canHover.matches) maybeClose();
    });
    link.addEventListener("click", () => {
      if (pinned && active === link && isOpen()) close();
      else show(link, true);
    });
    link.addEventListener("focus", () => {
      if (!returningFocus && !pinned) show(link);
    });
    link.addEventListener("blur", maybeClose);
  }
  popup.addEventListener("pointerenter", () => clearTimeout(leaveTimer));
  popup.addEventListener("pointerleave", maybeClose);

  function restoreFocus(link) {
    if (!link) return;
    returningFocus = true;
    link.focus({ preventScroll: true });
    returningFocus = false;
  }
  popup
    .querySelector("[data-close-frame]")
    .addEventListener("click", (event) => {
      const previous = active;
      close();
      if (event.detail === 0) restoreFocus(previous);
    });

  document.addEventListener("pointerdown", (event) => {
    if (
      isOpen() &&
      !popup.contains(event.target) &&
      !event.target.closest("[data-frame-info]")
    )
      close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !isOpen()) return;
    event.preventDefault();
    const previous = active;
    close();
    restoreFocus(previous);
  });

  function updatePosition() {
    const available = reader.scrollHeight - reader.clientHeight;
    reader.classList.toggle("has-content-above", reader.scrollTop > 14);
    reader.classList.toggle(
      "has-content-below",
      available - reader.scrollTop > 14,
    );
    if (!isOpen() || !active) return;
    const rect = active.getBoundingClientRect();
    if (rect.bottom < 15 || rect.top > innerHeight - 15) close();
    else {
      clearTimeout(moveTimer);
      popup.classList.remove("is-moving");
      position(active);
    }
  }
  function scheduleUpdate() {
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(() => {
      scrollScheduled = false;
      updatePosition();
    });
  }
  reader.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate, { passive: true });
  updatePosition();
})();

// Ambient player.
const TRACKS = [
  "assets/Bg_Audio_1.mp3",
  "assets/Bg_Audio_2.mp3",
  "assets/Bg_Audio_3.mp3",
  "assets/Bg_Audio_4.mp3",
  "assets/Bg_Audio_5.mp3",
];

(() => {
  const dock = document.querySelector("#sound-dock");
  const button = dock.querySelector("[data-sound-toggle]");
  const status = dock.querySelector("[data-sound-status]");
  const slider = dock.querySelector("[data-volume-slider]");
  const value = dock.querySelector("[data-volume-value]");
  const rail = dock.querySelector(".volume-rail");
  const touch = matchMedia("(hover: none)");
  const audio = new Audio();
  audio.preload = "none";

  let mode = "loading";
  let wantsAudio = true;
  let lastVolume = 4;
  let current = -1;
  let previous = -1;
  let queue = [];
  let request = 0;
  const failed = new Set();
  const volume = () => Number(slider.value);

  function render() {
    const playing =
      mode === "playing" && !audio.paused && !audio.muted && audio.volume > 0;
    dock.dataset.audioState = playing ? "playing" : mode;
    if (!playing) dock.classList.remove("is-open");
    const expanded = playing && dock.classList.contains("is-open");
    slider.disabled = !playing;
    dock
      .querySelector("#volume-panel")
      .setAttribute("aria-hidden", String(!playing));
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("aria-pressed", String(playing));
    const label = playing
      ? "Pause ambient music"
      : mode === "loading"
        ? "Starting ambient music"
        : mode === "error"
          ? "Music unavailable"
          : mode === "blocked"
            ? "Play ambient music (browser blocked autoplay)"
            : "Play ambient music";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.disabled = mode === "error";
    status.textContent =
      mode === "blocked"
        ? "Autoplay blocked. Press to play music."
        : mode === "error"
          ? "Music unavailable."
          : playing
            ? "Ambient music playing."
            : "Ambient music off.";
  }

  function drawSlider() {
    const percent = volume() / Number(slider.max);
    rail.style.setProperty("--fill", `${percent * 100}%`);
    rail.style.setProperty("--thumb-y", `${7 + (1 - percent) * 102}px`);
    value.textContent = `${String(volume()).padStart(2, "0")}%`;
    slider.setAttribute("aria-valuetext", `${volume()} percent`);
  }

  function reshuffle() {
    queue = TRACKS.map((_, index) => index).filter(
      (index) => !failed.has(index),
    );
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    if (queue.length > 1 && queue[queue.length - 1] === previous) {
      [queue[0], queue[queue.length - 1]] = [queue[queue.length - 1], queue[0]];
    }
  }

  function nextTrack() {
    if (!queue.length) reshuffle();
    if (!queue.length) return false;
    current = queue.pop();
    previous = current;
    audio.src = TRACKS[current];
    audio.loop = TRACKS.length - failed.size === 1;
    return true;
  }

  function skipBroken() {
    if (current < 0 || failed.has(current)) return;
    failed.add(current);
    ++request;
    if (failed.size === TRACKS.length) {
      wantsAudio = false;
      mode = "error";
      render();
    } else if (wantsAudio && nextTrack()) {
      play();
    }
  }

  function play(openAfterStart = false) {
    if (mode === "error") return;
    wantsAudio = true;
    if (!volume()) {
      slider.value = String(lastVolume);
      drawSlider();
    }
    if (current < 0 && !nextTrack()) return;
    audio.muted = false;
    audio.volume = volume() / 100;
    const id = ++request;
    mode = "loading";
    render();
    audio
      .play()
      .then(() => {
        if (id !== request || !wantsAudio) return;
        mode = "playing";
        if (openAfterStart && touch.matches) dock.classList.add("is-open");
        render();
      })
      .catch((error) => {
        if (id !== request) return;
        if (error.name === "NotAllowedError" || error.name === "AbortError") {
          mode = "blocked";
          render();
        } else {
          skipBroken();
        }
      });
  }

  function pause() {
    wantsAudio = false;
    ++request;
    audio.pause();
    mode = "paused";
    render();
  }

  audio.addEventListener("ended", () => {
    if (wantsAudio && nextTrack()) play();
  });
  audio.addEventListener("error", skipBroken);
  audio.addEventListener("pause", () => {
    if (mode === "playing" && wantsAudio) {
      mode = "paused";
      render();
    }
  });

  slider.addEventListener("input", () => {
    drawSlider();
    if (!volume()) {
      wantsAudio = false;
      ++request;
      audio.muted = true;
      audio.pause();
      mode = "muted";
      render();
      return;
    }
    lastVolume = volume();
    audio.muted = false;
    audio.volume = volume() / 100;
  });

  button.addEventListener("click", () => {
    if (mode === "playing") {
      if (touch.matches && !dock.classList.contains("is-open")) {
        dock.classList.add("is-open");
        render();
      } else {
        pause();
      }
    } else {
      play(touch.matches);
    }
  });

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!dock.contains(event.target)) dock.classList.remove("is-open");
    },
    { capture: true },
  );
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !dock.classList.contains("is-open")) return;
    dock.classList.remove("is-open");
    render();
    button.focus({ preventScroll: true });
  });

  drawSlider();
  render();
  play();
})();
