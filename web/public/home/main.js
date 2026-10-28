// Canvas homepage: the same galaxy treatment as the bundled main-site homepage.
// Content stays static; all business actions are plain links into the SPA.
import { createAstraScene, detectWebGL, renderStaticFallback, PALETTES } from "../brand/starflow.js";

const $ = (selector) => document.querySelector(selector);
const smallScreen = matchMedia("(max-width: 720px)");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const coarsePointer = matchMedia("(pointer: coarse)");
let scene = null;
let paused = reducedMotion.matches;
let canvas = $("#galaxy");
let updateFrame = 0;

PALETTES.ciyuan = ["#5FE0F0", "#48F0BC", "#9A7BFF", "#C9B6FF", "#F2FBFF"];

function fieldOptions() {
  return { starCount: smallScreen.matches ? 1300 : 4200, size: 2.05, scatter: .041, backgroundRatio: smallScreen.matches ? .22 : .16, rotationDepth: 1.4, palette: "ciyuan" };
}

function resetCanvas() {
  scene?.dispose();
  scene = null;
  const replacement = canvas.cloneNode(false);
  canvas.replaceWith(replacement);
  canvas = replacement;
  canvas.addEventListener("webglcontextlost", () => { paused = true; staticScene(); }, { once: true });
}

function staticScene() {
  resetCanvas();
  renderStaticFallback(canvas, { type: "galaxy" }, { ...fieldOptions(), fillX: smallScreen.matches ? .92 : .65, fillY: smallScreen.matches ? .58 : .76 });
  document.body.classList.add("scene-ready");
  document.body.dataset.scene = "static";
}

function startScene() {
  if (paused || !detectWebGL()) {
    if (!detectWebGL()) paused = true;
    staticScene();
    return;
  }
  resetCanvas();
  const mobile = smallScreen.matches;
  try {
    scene = createAstraScene(canvas, {
      quality: mobile ? "lite" : "full", pixelBudget: mobile ? 650000 : 1800000,
      adaptiveQuality: true, reducedMotion: false, introDuration: 2.6,
      fillX: mobile ? .95 : .62, fillY: mobile ? .58 : .78,
      center: mobile ? [.12, .37] : [.10, .10],
      autoRotate: true, autoRotateAmount: .14, autoRotateSpeed: .18,
      pointerRepel: !coarsePointer.matches, pointerFollow: coarsePointer.matches ? 0 : .38,
      bloomIntensity: mobile ? .6 : .78, bloomThreshold: .08,
      intensity: 1.32, flowSpeed: .78, twinkleSpeed: .6,
      sizeScale: 1, sizeFalloff: .45,
      ambientColor: "#0F3D4E", ambientOpacity: .52, vignette: 1,
    });
    scene.setSource({ type: "galaxy" }, fieldOptions());
    document.body.classList.add("scene-ready");
    document.body.dataset.scene = "animated";
    updateScroll();
  } catch (error) {
    console.warn("Dynamic galaxy unavailable; using a static fallback.", error.message);
    paused = true;
    staticScene();
  }
}

function updateScroll() {
  updateFrame = 0;
  if (!scene) return;
  const height = innerHeight;
  scene.setScroll({
    progress: Math.min(1.4, scrollY / Math.max(height * .86, 1)),
    starsOpacity: scrollY > height * 3.2 ? .65 : 1,
  });
}
function queueScroll() { if (!updateFrame) updateFrame = requestAnimationFrame(updateScroll); }

// Keep the decorative canvas behind the content; forward hover without blocking links or scrolling.
let pointerActive = false;
function clearPointer() {
  if (pointerActive) canvas.dispatchEvent(new PointerEvent("pointerleave"));
  pointerActive = false;
}
document.addEventListener("pointermove", (event) => {
  if (event.target === canvas) return;
  if (!scene || paused || coarsePointer.matches || event.pointerType === "touch" ||
      event.target.closest("a, button, input, textarea, select")) {
    clearPointer();
    return;
  }
  pointerActive = true;
  canvas.dispatchEvent(new PointerEvent("pointermove", {
    clientX: event.clientX, clientY: event.clientY,
    pointerId: event.pointerId, pointerType: event.pointerType,
  }));
}, { passive: true });
document.documentElement.addEventListener("pointerleave", clearPointer);
window.addEventListener("blur", clearPointer);
window.addEventListener("scroll", queueScroll, { passive: true });
window.addEventListener("resize", () => { if (scene) queueScroll(); else staticScene(); }, { passive: true });
smallScreen.addEventListener("change", startScene);
reducedMotion.addEventListener("change", () => { paused = reducedMotion.matches; startScene(); document.body.classList.toggle("motion-enabled", !paused); });
window.addEventListener("pagehide", () => { scene?.dispose(); scene = null; if (updateFrame) cancelAnimationFrame(updateFrame); });
window.addEventListener("pageshow", (event) => { if (event.persisted) startScene(); });

if (!reducedMotion.matches) document.body.classList.add("motion-enabled");
const revealObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      entry.target.classList.add("visible");
      revealObserver.unobserve(entry.target);
    }
  }
}, { threshold: .08 });
document.querySelectorAll(".reveal").forEach((element) => revealObserver.observe(element));

startScene();
