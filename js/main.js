const KEY = "audience-sagesse-v1";

const tracksMax = { maison: 26, route: 26, attention: 22, franchise: 16 };

const emptyState = () => ({
  open: false,
  sound: true,
  calm: false,
  lumiere: false,
  creneau: false,
  miettes: 0,
  swept: [],
  oreille: false,
  pages: 0,
  chocolat: null,
  priorite: false,
  kept: { route: false, attention: false, maison: false },
});

let state = load();
let audioCtx = null;
let earFrame = 0;
let lastAnnounced = "";
let resetArmed = false;
let lenis = null;

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const allowLenis =
  !reduceMotion &&
  !window.matchMedia("(any-pointer: coarse)").matches &&
  window.matchMedia("(pointer: fine)").matches;

const $ = (id) => document.getElementById(id);

function load() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (!saved || typeof saved !== "object") return emptyState();
    const swept = Array.isArray(saved.swept)
      ? saved.swept.filter((index) => index >= 0 && index < 5)
      : Array.from({ length: Math.min(5, saved.miettes || 0) }, (_, index) => index);
    return {
      ...emptyState(),
      ...saved,
      swept,
      miettes: swept.length,
      kept: { ...emptyState().kept, ...(saved.kept || {}) },
    };
  } catch (error) {
    return emptyState();
  }
}

function save() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch (error) {}
}

function crumbPoints(count) {
  if (count >= 5) return 14;
  if (count >= 3) return 8;
  if (count >= 1) return 4;
  return 0;
}

function evaluate(current) {
  const maison = (current.lumiere ? 12 : 0) + crumbPoints(current.miettes);
  const route = (current.creneau ? 14 : 0) + (current.priorite ? 12 : 0);
  const attention = (current.oreille ? 12 : 0) + (current.pages >= 2 ? 10 : 0);
  let franchise = 0;
  if (current.chocolat === "avoue") franchise = 16;
  if (current.chocolat === "nie") franchise = -6;
  const done = [
    current.lumiere,
    current.creneau,
    current.miettes >= 3,
    current.oreille,
    current.pages >= 2,
    current.chocolat !== null,
    current.priorite,
  ].filter(Boolean).length;
  const bonus = done === 7 ? 10 : 0;
  const raw = maison + route + attention + franchise + bonus;
  const score = Math.max(0, Math.min(100, raw));
  return { maison, route, attention, franchise, bonus, done, score };
}

function mentionFor(score) {
  if (score < 45) return "Le traîneau reste au chaud";
  if (score < 70) return "Sage par endroits";
  if (score < 85) return "Assez sage pour qu’on en parle";
  return "Le registre est convaincu";
}

function lineFor(score, done) {
  if (!state.open) return "Le dossier est encore scellé.";
  if (done === 0) return "Le registre est ouvert. Montrez-moi.";
  if (score < 45) return "Je lis. Ce n’est pas encore une année.";
  if (score < 70) return "Il y a du vrai. Pas de quoi tout ouvrir.";
  if (score < 85) return "Là, on peut parler atelier.";
  return "Bon. J’ai assez vu.";
}

function openTracks(result) {
  const ranked = [
    ["maison", result.maison, 0],
    ["route", result.route, 1],
    ["attention", result.attention, 2],
  ].sort((a, b) => b[1] - a[1] || a[2] - b[2]);
  if (result.score < 45) return [];
  if (result.score < 70) return [ranked[0][0]];
  if (result.score < 85) return [ranked[0][0], ranked[1][0]];
  return ["maison", "route", "attention"];
}

function names() {
  return {
    route: "Dashcam DEALAZOT X4",
    attention: "Tablette Amazon Alexa 8",
    maison: "Robot Tapo RV30 Max Turbo",
  };
}

function calmOn() {
  return state.calm || reduceMotion || document.documentElement.classList.contains("is-calm");
}

function thump(freq) {
  if (!state.sound || calmOn()) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === "suspended") audioCtx.resume();
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(70, now + 0.16);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.05, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.24);
}

function placeCar(x) {
  const car = $("car");
  const street = $("street");
  const max = Math.max(0, street.clientWidth - car.offsetWidth);
  const next = Math.min(max, Math.max(0, x));
  car.style.transform = `translateX(${next}px)`;
  car.dataset.x = String(next);
  car.dataset.max = String(max);
  return { next, max };
}

function layoutCar() {
  const street = $("street");
  const car = $("car");
  if (street.clientWidth < 40) return;
  const max = street.clientWidth - car.offsetWidth;
  placeCar(state.creneau ? max / 2 : max * 0.08);
}

function parkAligned() {
  const street = $("street");
  if (street.clientWidth < 40) return;
  placeCar((street.clientWidth - $("car").offsetWidth) / 2);
  if (!state.creneau) thump(210);
  state.creneau = true;
  changed();
}

function finishEar() {
  if (state.oreille) return;
  state.oreille = true;
  $("ear").style.setProperty("--p", "1");
  $("ear").dataset.running = "0";
  thump(160);
  changed();
}

function listen() {
  const ear = $("ear");
  if (state.oreille || ear.dataset.running === "1") return;
  if (calmOn()) {
    finishEar();
    return;
  }
  ear.dataset.running = "1";
  const started = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - started) / 1600);
    ear.style.setProperty("--p", progress.toFixed(3));
    if (progress < 1) earFrame = requestAnimationFrame(step);
    else finishEar();
  };
  earFrame = requestAnimationFrame(step);
}

function render() {
  const result = evaluate(state);
  const opened = openTracks(result);
  for (const track of Object.keys(state.kept)) {
    if (!opened.includes(track)) state.kept[track] = false;
  }

  document.documentElement.classList.toggle("is-open", state.open);
  document.documentElement.classList.toggle("is-calm", state.calm || reduceMotion);

  const lumiere = $("preuve-lumiere");
  lumiere.classList.toggle("is-dark", state.lumiere);
  lumiere.classList.toggle("is-done", state.lumiere);
  $("switch").setAttribute("aria-pressed", String(state.lumiere));
  $("switch-label").textContent = state.lumiere
    ? "C’est éteint. On peut rallumer, la preuve se retire."
    : "La pièce est allumée. L’éteindre.";
  $("stamp-lumiere").hidden = !state.lumiere;
  $("status-lumiere").textContent = state.lumiere ? "Vu. La maison sait s’éteindre." : "";

  const creneau = $("preuve-creneau");
  creneau.classList.toggle("is-done", state.creneau);
  $("stamp-creneau").hidden = !state.creneau;
  $("park-easy").disabled = state.creneau;
  $("status-creneau").textContent = state.creneau ? "Aligné. Je note la prudence." : "";

  const sol = $("preuve-sol");
  const crumbs = [...document.querySelectorAll("[data-crumb]")];
  crumbs.forEach((crumb, index) => {
    const gone = state.swept.includes(index);
    crumb.classList.toggle("is-gone", gone);
    crumb.disabled = gone;
  });
  const solDone = state.miettes >= 3;
  sol.classList.toggle("is-done", solDone);
  $("stamp-sol").hidden = !solDone;
  $("stamp-sol").textContent = state.miettes >= 5 ? "Propre." : "Presque.";
  $("status-sol").textContent = solDone
    ? (state.miettes >= 5 ? "Propre. Assez." : "Presque. Le registre n’est pas un tyran.")
    : `${state.miettes} ${state.miettes > 1 ? "miettes" : "miette"} sur 5.`;

  const oreille = $("preuve-oreille");
  oreille.classList.toggle("is-done", state.oreille);
  $("stamp-oreille").hidden = !state.oreille;
  $("whisper").hidden = !state.oreille;
  $("ear").disabled = state.oreille;
  $("status-oreille").textContent = state.oreille ? "Entendu. Sans en faire un exploit." : "";

  const pages = $("preuve-pages");
  pages.classList.toggle("is-done", state.pages >= 2);
  $("book").dataset.pages = String(state.pages);
  $("page-count").textContent = `${state.pages} / 2`;
  $("page-btn").disabled = state.pages >= 2;
  $("stamp-pages").hidden = state.pages < 2;
  $("status-pages").textContent = state.pages >= 2 ? "Lu. Pas de quoi fanfaronner. Assez pour compter." : "";

  const chocolat = $("preuve-chocolat");
  chocolat.classList.toggle("is-done", state.chocolat !== null);
  chocolat.classList.toggle("is-denied", state.chocolat === "nie");
  $("confess").disabled = state.chocolat !== null;
  $("deny").disabled = state.chocolat !== null;
  $("confess").setAttribute("aria-pressed", String(state.chocolat === "avoue"));
  $("deny").setAttribute("aria-pressed", String(state.chocolat === "nie"));
  $("stamp-chocolat").hidden = state.chocolat === null;
  $("stamp-chocolat").textContent = state.chocolat === "nie" ? "Esquive." : "Franc.";
  $("status-chocolat").textContent =
    state.chocolat === "avoue"
      ? "Franc. Le registre préfère ça à une auréole."
      : state.chocolat === "nie"
        ? "Noté quand même. Autrement."
        : "";

  const priorite = $("preuve-priorite");
  priorite.classList.toggle("is-done", state.priorite);
  $("yield-scene").classList.toggle("is-yielding", state.priorite);
  $("yield-btn").disabled = state.priorite;
  $("stamp-priorite").hidden = !state.priorite;
  $("status-priorite").textContent = state.priorite ? "Une fois vraie. Je la prends." : "";

  $("live-score").textContent = String(result.score);
  $("final-score").textContent = String(result.score);
  $("mention").textContent = state.open ? mentionFor(result.score) : "Le traîneau n’a pas encore assez lu.";
  $("live-done").textContent = `${result.done} ${result.done > 1 ? "preuves tenues" : "preuve tenue"} sur 7`;
  $("live-line").textContent = lineFor(result.score, result.done);
  $("bonus-line").textContent = result.bonus ? "Dossier complet. Dix points de plus, pour avoir tout regardé." : "";

  for (const key of ["maison", "route", "attention", "franchise"]) {
    const value = result[key];
    $(`pts-${key}`).textContent = String(value);
    const ratio = key === "franchise" && value < 0 ? 0 : Math.max(0, value / tracksMax[key]);
    $(`bar-${key}`).style.setProperty("--n", ratio.toFixed(3));
  }

  document.querySelectorAll(".gift").forEach((gift) => {
    const track = gift.dataset.track;
    const isOpen = opened.includes(track);
    gift.classList.toggle("is-open", isOpen);
    gift.classList.toggle("is-locked", !isOpen);
    gift.classList.toggle("is-kept", Boolean(state.kept[track]));
    const body = gift.querySelector(".gift-body");
    const face = gift.querySelector(".sealed-face");
    body.hidden = !isOpen;
    face.hidden = isOpen;
    const keep = gift.querySelector("[data-keep]");
    keep.textContent = state.kept[track] ? "Retiré de la hotte" : "Retenir dans la hotte";
    keep.setAttribute("aria-pressed", String(Boolean(state.kept[track])));
  });

  const keptNames = Object.entries(state.kept)
    .filter(([, kept]) => kept)
    .map(([track]) => names()[track]);
  const lead = $("decree-lead");
  const list = $("decree-list");
  list.replaceChildren();

  if (result.score < 45) {
    lead.textContent = "Le dossier doit encore être lu. Les enveloppes restent fermées.";
  } else if (result.score < 70) {
    lead.textContent = "Une piste correspond à ce que vous avez vraiment vu. Les deux autres peuvent attendre une autre lecture, ou une meilleure idée à vous.";
  } else if (result.score < 85) {
    lead.textContent = "Deux pistes tiennent. La troisième demanderait un dossier plus complet, ou plus franc.";
  } else {
    lead.textContent = "Les trois pistes sont recevables. Ce n’est toujours pas une obligation. C’est une autorisation.";
  }

  if (keptNames.length) {
    keptNames.forEach((name) => {
      const item = document.createElement("li");
      item.textContent = name;
      list.append(item);
    });
    $("decree-end").textContent = "Voilà ce qui entre dans la hotte. Le reste peut attendre une autre année, ou une meilleure idée. La maison vous remercie d’avoir lu jusqu’au bout.";
  } else if (result.score >= 45) {
    $("decree-end").textContent = "La hotte est encore vide. Vous pouvez retenir une piste, ou n’en retenir aucune. La maison vous remercie d’avoir tenu le rôle. Le dernier mot reste le vôtre.";
  } else {
    $("decree-end").textContent = "Les preuves sont plus haut, si vous voulez continuer l’audience. Le dernier mot reste le vôtre.";
  }

  $("seal-caption").textContent = state.open ? "Le sceau est levé." : "Poser la main sur le sceau.";
  $("mute").setAttribute("aria-pressed", String(!state.sound));
  $("mute").textContent = state.sound ? "Son" : "Son coupé";
  $("calm").setAttribute("aria-pressed", String(state.calm || reduceMotion));
  $("calm").textContent = state.calm || reduceMotion ? "Calme" : "Mouvement";

  const announcement = `${result.score} sur 100. ${mentionFor(result.score)}. ${lineFor(result.score, result.done)}`;
  if (announcement !== lastAnnounced && state.open) {
    $("live-announce").textContent = announcement;
    lastAnnounced = announcement;
  }
}

function changed() {
  render();
  save();
}

function bind() {
  $("seal").addEventListener("click", () => {
    const wasOpen = state.open;
    state.open = true;
    save();
    render();
    if (!wasOpen) {
      thump(140);
      requestAnimationFrame(() => {
        layoutCar();
        ensureMotion();
        const target = "#lettre";
        if (lenis && !calmOn()) lenis.scrollTo(target, { offset: -12 });
        else $("lettre").scrollIntoView({ behavior: calmOn() ? "auto" : "smooth", block: "start" });
      });
    }
  });

  $("switch").addEventListener("click", () => {
    state.lumiere = !state.lumiere;
    if (state.lumiere) thump(180);
    changed();
  });

  const car = $("car");
  let dragging = false;
  car.addEventListener("pointerdown", (event) => {
    if (state.creneau) return;
    dragging = true;
    car.setPointerCapture(event.pointerId);
  });
  car.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const rect = $("street").getBoundingClientRect();
    placeCar(event.clientX - rect.left - car.offsetWidth / 2);
  });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    const x = Number(car.dataset.x || 0);
    const max = Number(car.dataset.max || 0);
    if (max > 0 && Math.abs(x - max / 2) <= Math.max(18, max * 0.12)) parkAligned();
    else $("status-creneau").textContent = "Pas encore entre les lignes.";
  };
  car.addEventListener("pointerup", release);
  car.addEventListener("pointercancel", release);
  car.addEventListener("keydown", (event) => {
    if (state.creneau) return;
    const current = Number(car.dataset.x || 0);
    if (event.key === "ArrowRight") {
      placeCar(current + 16);
      event.preventDefault();
    }
    if (event.key === "ArrowLeft") {
      placeCar(current - 16);
      event.preventDefault();
    }
    if (event.key === "Enter") {
      const x = Number(car.dataset.x || 0);
      const max = Number(car.dataset.max || 0);
      if (max > 0 && Math.abs(x - max / 2) <= Math.max(18, max * 0.12)) parkAligned();
      else $("status-creneau").textContent = "Pas encore entre les lignes.";
      event.preventDefault();
    }
  });
  $("park-easy").addEventListener("click", () => parkAligned());

  document.querySelectorAll("[data-crumb]").forEach((crumb, index) => {
    crumb.setAttribute("aria-label", `Ramasser la miette ${index + 1}`);
    crumb.addEventListener("click", () => {
      if (state.swept.includes(index)) return;
      state.swept.push(index);
      state.miettes = state.swept.length;
      if (state.miettes === 3 || state.miettes === 5) thump(190);
      changed();
    });
  });

  $("ear").addEventListener("click", listen);

  $("page-btn").addEventListener("click", () => {
    if (state.pages >= 2) return;
    state.pages += 1;
    if (state.pages === 2) thump(170);
    changed();
  });

  $("confess").addEventListener("click", () => {
    if (state.chocolat) return;
    state.chocolat = "avoue";
    thump(150);
    changed();
  });
  $("deny").addEventListener("click", () => {
    if (state.chocolat) return;
    state.chocolat = "nie";
    thump(90);
    changed();
  });

  $("yield-btn").addEventListener("click", () => {
    if (state.priorite) return;
    state.priorite = true;
    thump(200);
    changed();
  });

  document.querySelectorAll("[data-keep]").forEach((button) => {
    button.addEventListener("click", () => {
      const track = button.dataset.keep;
      const result = evaluate(state);
      if (!openTracks(result).includes(track)) return;
      state.kept[track] = !state.kept[track];
      thump(state.kept[track] ? 220 : 110);
      changed();
    });
  });

  $("mute").addEventListener("click", () => {
    state.sound = !state.sound;
    changed();
  });
  $("calm").addEventListener("click", () => {
    if (reduceMotion) return;
    state.calm = !state.calm;
    if (state.calm) {
      if (lenis) {
        lenis.destroy();
        lenis = null;
      }
      if (window.gsap) window.gsap.set("[data-reveal]", { opacity: 1, y: 0, clearProps: "opacity,transform" });
    }
    changed();
  });
  $("reset").addEventListener("click", () => {
    if (!resetArmed) {
      resetArmed = true;
      $("reset").textContent = "Effacer vraiment ?";
      window.setTimeout(() => {
        resetArmed = false;
        $("reset").textContent = "Recommencer";
      }, 2800);
      return;
    }
    sessionStorage.removeItem(KEY);
    location.reload();
  });

  window.addEventListener("resize", () => layoutCar());
}

let motionReady = false;

function ensureMotion() {
  if (calmOn() || motionReady || !window.gsap || !window.ScrollTrigger) return;
  motionReady = true;
  setupMotion();
}

function setupMotion() {
  if (calmOn() || !window.gsap || !window.ScrollTrigger) return;
  window.gsap.registerPlugin(window.ScrollTrigger);
  if (allowLenis && window.Lenis) {
    lenis = new window.Lenis({ lerp: 0.1, smoothWheel: true });
    lenis.on("scroll", window.ScrollTrigger.update);
    window.gsap.ticker.add((time) => lenis.raf(time * 1000));
    window.gsap.ticker.lagSmoothing(0);
  }
  window.gsap.utils.toArray("[data-reveal]").forEach((el) => {
    window.gsap.from(el, {
      y: 28,
      opacity: 0,
      duration: 0.8,
      ease: "power2.out",
      scrollTrigger: { trigger: el, start: "top 88%" },
    });
  });
}

function setupSnow() {
  if (calmOn()) return;
  const canvas = $("snow");
  const ctx = canvas.getContext("2d");
  const flakes = Array.from({ length: 56 }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: Math.random() * 1.5 + 0.4,
    s: Math.random() * 0.35 + 0.12,
    d: Math.random() * 0.25 - 0.12,
  }));
  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resize();
  window.addEventListener("resize", resize);
  const frame = () => {
    if (!document.hidden && !document.documentElement.classList.contains("is-calm")) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      for (const flake of flakes) {
        flake.y += flake.s / 700;
        flake.x += flake.d / 900;
        if (flake.y > 1) flake.y = 0;
        if (flake.x > 1) flake.x = 0;
        if (flake.x < 0) flake.x = 1;
        ctx.beginPath();
        ctx.arc(flake.x * canvas.width, flake.y * canvas.height, flake.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    requestAnimationFrame(frame);
  };
  frame();
}

function init() {
  if (state.calm || reduceMotion) document.documentElement.classList.add("is-calm");
  bind();
  render();
  setupSnow();
  if (state.open) {
    requestAnimationFrame(() => {
      layoutCar();
      ensureMotion();
    });
  }
}

init();
