import { useEffect, useRef, useState } from "react";
import finishVideo from "../assets/training/finish.mp4";
import finishPoster from "../assets/training/finish.webp";
import "./finishFilm.css";

export function FinishFilm() {
  const frame = useRef(null);
  const video = useRef(null);
  const [showFilm, setShowFilm] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);

  useEffect(() => {
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!motion || !window.IntersectionObserver) return;
    const reducedData = window.matchMedia("(prefers-reduced-data: reduce)");
    const connection = navigator.connection;
    let inView = false;
    let started = false;
    const update = () => {
      const restricted = motion.matches || reducedData.matches || connection?.saveData
        || frame.current?.closest('[data-motion="reduced"], [data-motion="still"]');
      if (!inView || document.hidden || restricted) {
        setShowFilm(false);
      } else if (!started) {
        started = true;
        setShowFilm(true);
      }
    };
    const visibility = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting && entry.intersectionRatio >= 0.5;
      update();
    }, { threshold: 0.5 });
    visibility.observe(frame.current);
    const settings = new MutationObserver(update);
    for (let el = frame.current; el; el = el.parentElement) {
      settings.observe(el, { attributes: true, attributeFilter: ["data-motion"] });
    }
    motion.addEventListener?.("change", update);
    reducedData.addEventListener?.("change", update);
    connection?.addEventListener?.("change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      visibility.disconnect();
      settings.disconnect();
      motion.removeEventListener?.("change", update);
      reducedData.removeEventListener?.("change", update);
      connection?.removeEventListener?.("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  useEffect(() => {
    if (!showFilm) return;
    const clip = video.current;
    let mounted = true;
    clip.play().catch(() => {
      if (mounted) setShowFilm(false);
    });
    return () => {
      mounted = false;
      clip.pause();
    };
  }, [showFilm]);

  return (
    <div ref={frame} className="box-finish-art" aria-hidden="true" hidden={posterFailed && !showFilm}>
      <img src={finishPoster} alt="" loading="lazy" decoding="async" onError={() => setPosterFailed(true)} />
      {showFilm && (
        <video
          ref={video} src={finishVideo} poster={finishPoster} muted playsInline preload="none"
          disablePictureInPicture onError={() => setShowFilm(false)}
        />
      )}
    </div>
  );
}
