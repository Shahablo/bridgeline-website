/*
 * BridgeLine Health — interactions
 * Progressive enhancement: every feature checks for its dependencies and the
 * page remains fully readable with JS, GSAP, or WebGL unavailable.
 */
(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasGsap = typeof window.gsap !== 'undefined';
  const hasST = hasGsap && typeof window.ScrollTrigger !== 'undefined';
  const animate = hasST && !reducedMotion;

  if (hasST) window.gsap.registerPlugin(window.ScrollTrigger);

  // If animation can't run, make sure nothing stays at opacity:0
  if (!animate) document.documentElement.classList.remove('anim-ok');

  /* ---------- header ---------- */
  const header = $('.header');
  const heroWatch = $('[data-header-flip]');

  if (header) {
    if (heroWatch && 'IntersectionObserver' in window) {
      new IntersectionObserver(
        ([entry]) => header.classList.toggle('header--light', !entry.isIntersecting),
        { rootMargin: `-${header.offsetHeight}px 0px 0px 0px`, threshold: 0 }
      ).observe(heroWatch);
    } else {
      header.classList.add('header--light');
    }

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        header.classList.toggle('header--raised', window.scrollY > 12);
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- mobile menu ---------- */
  const menuBtn = $('.menu-btn');
  const mobileMenu = $('.mobile-menu');

  if (menuBtn && mobileMenu) {
    const setOpen = (open) => {
      menuBtn.setAttribute('aria-expanded', String(open));
      if (open) {
        mobileMenu.hidden = false;
        if (hasGsap && !reducedMotion) {
          window.gsap.fromTo(
            mobileMenu,
            { autoAlpha: 0, y: -10 },
            { autoAlpha: 1, y: 0, duration: 0.28, ease: 'power2.out' }
          );
          window.gsap.fromTo(
            $$('.mobile-menu li, .mobile-menu .btn'),
            { autoAlpha: 0, y: -6 },
            { autoAlpha: 1, y: 0, duration: 0.3, stagger: 0.035, ease: 'power2.out', delay: 0.05 }
          );
        }
      } else if (hasGsap && !reducedMotion && !mobileMenu.hidden) {
        window.gsap.to(mobileMenu, {
          autoAlpha: 0,
          y: -8,
          duration: 0.2,
          ease: 'power2.in',
          onComplete: () => {
            mobileMenu.hidden = true;
            window.gsap.set(mobileMenu, { clearProps: 'all' });
          },
        });
      } else {
        mobileMenu.hidden = true;
      }
    };

    menuBtn.addEventListener('click', () => {
      setOpen(menuBtn.getAttribute('aria-expanded') !== 'true');
    });
    $$('.mobile-menu a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menuBtn.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        menuBtn.focus();
      }
    });
  }

  /* ---------- FAQ accordion ---------- */
  $$('.faq-item').forEach((item) => {
    const summary = $('summary', item);
    const body = $('.faq__body', item);
    if (!summary || !body) return;
    if (item.open) item.classList.add('is-open');

    summary.addEventListener('click', (e) => {
      if (!hasGsap || reducedMotion) {
        // native toggle; just sync the icon class after the toggle happens
        requestAnimationFrame(() => item.classList.toggle('is-open', item.open));
        return;
      }
      e.preventDefault();
      if (item.dataset.busy) return;
      item.dataset.busy = '1';

      if (item.open) {
        item.classList.remove('is-open');
        window.gsap.to(body, {
          height: 0,
          autoAlpha: 0,
          duration: 0.3,
          ease: 'power2.inOut',
          onComplete: () => {
            item.open = false;
            delete item.dataset.busy;
            window.gsap.set(body, { clearProps: 'all' });
          },
        });
      } else {
        item.open = true;
        item.classList.add('is-open');
        window.gsap.fromTo(
          body,
          { height: 0, autoAlpha: 0 },
          {
            height: 'auto',
            autoAlpha: 1,
            duration: 0.38,
            ease: 'power2.out',
            onComplete: () => {
              delete item.dataset.busy;
              window.gsap.set(body, { clearProps: 'height' });
            },
          }
        );
      }
    });
  });

  /* ---------- footer year ---------- */
  const yearEl = $('[data-year]');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- process timeline (works with and without animation) ---------- */
  const steps = $$('.t-step');
  if (!animate) steps.forEach((s) => s.classList.add('is-active'));

  /* ---------- GSAP choreography ---------- */
  if (animate) {
    const gsap = window.gsap;
    const ScrollTrigger = window.ScrollTrigger;

    // Hero entrance
    const heroEls = $$('[data-hero]');
    if (heroEls.length) {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.fromTo(
        heroEls,
        { autoAlpha: 0, y: 30 },
        { autoAlpha: 1, y: 0, duration: 0.95, stagger: 0.1, delay: 0.15 }
      );
      const underline = $('.hero__title .underline path');
      if (underline) {
        const len = underline.getTotalLength();
        gsap.set(underline, { strokeDasharray: len, strokeDashoffset: len });
        tl.to(underline, { strokeDashoffset: 0, duration: 0.9, ease: 'power2.inOut' }, 0.75);
      }
    }

    // floating match card: slow ambient drift after the entrance settles
    const matchCard = $('.hero__match');
    if (matchCard) {
      gsap.to(matchCard, {
        y: -9,
        duration: 3.4,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
        delay: 1.6,
      });
    }

    // Generic reveals
    $$('[data-reveal]').forEach((el) => {
      gsap.fromTo(
        el,
        { autoAlpha: 0, y: 28 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.9,
          ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 87%', once: true },
        }
      );
    });

    // Staggered groups
    $$('[data-reveal-stagger]').forEach((group) => {
      const children = [...group.children];
      if (!children.length) return;
      const stagger = parseFloat(group.dataset.revealStagger) || 0.09;
      gsap.fromTo(
        children,
        { autoAlpha: 0, y: 24 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.75,
          ease: 'power3.out',
          stagger,
          scrollTrigger: { trigger: group, start: 'top 85%', once: true },
        }
      );
    });

    // Metric counters
    $$('[data-count]').forEach((el) => {
      const target = parseFloat(el.dataset.count);
      if (Number.isNaN(target)) return;
      const obj = { v: 0 };
      gsap.to(obj, {
        v: target,
        duration: 1.5,
        ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        onUpdate: () => {
          el.textContent = Math.round(obj.v);
        },
      });
    });

    // Process timeline: progress line scrubs, steps light up in sequence
    const progress = $('.timeline__progress');
    const timeline = $('.timeline');
    if (progress && timeline) {
      gsap.fromTo(
        progress,
        { scaleY: 0 },
        {
          scaleY: 1,
          ease: 'none',
          scrollTrigger: {
            trigger: timeline,
            start: 'top 72%',
            end: 'bottom 45%',
            scrub: 0.5,
          },
        }
      );
      steps.forEach((step) => {
        ScrollTrigger.create({
          trigger: step,
          start: 'top 68%',
          onEnter: () => step.classList.add('is-active'),
          onLeaveBack: () => step.classList.remove('is-active'),
        });
      });
    }

    // Re-measure after web fonts settle
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => ScrollTrigger.refresh());
    }
  }

  /* ---------- Three.js hero (gated, lazy) ---------- */
  const canvas = $('[data-hero-canvas]');
  const hero = canvas && canvas.closest('.hero');

  const want3D =
    canvas &&
    hero &&
    !reducedMotion &&
    window.innerWidth >= 880 &&
    !(navigator.connection && navigator.connection.saveData) &&
    (() => {
      try {
        const test = document.createElement('canvas');
        return !!(test.getContext('webgl2') || test.getContext('webgl'));
      } catch {
        return false;
      }
    })();

  if (want3D) {
    const boot = () => {
      import('./hero-scene.js')
        .then((mod) => {
          const scene = mod.createHeroScene(canvas, { reducedMotion });
          if (scene) hero.classList.add('hero--3d');
        })
        .catch(() => {
          /* CDN unavailable — the SVG fallback stays in place */
        });
    };
    if (document.readyState === 'complete') {
      boot();
    } else {
      window.addEventListener('load', () => {
        if ('requestIdleCallback' in window) requestIdleCallback(boot, { timeout: 1200 });
        else setTimeout(boot, 150);
      });
    }
  }
})();
