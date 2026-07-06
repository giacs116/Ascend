// Ascend app shell: boot, theme, router, bottom nav.
import { h, todayStr, setUnits } from './util.js';
import { api } from './api.js';
import { ico, toast } from './ui.js';
import { renderOnboarding } from './views/onboarding.js';
import { renderToday } from './views/today.js';
import { renderFood } from './views/food.js';
import { renderTrain, renderWorkout } from './views/train.js';
import { renderBody } from './views/body.js';
import { renderProgress } from './views/progress.js';
import { renderCoach } from './views/coach.js';
import { renderFormCheck } from './views/formcheck.js';
import { renderSettings } from './views/settings.js';

const routes = {
  '#/today': renderToday,
  '#/food': renderFood,
  '#/train': renderTrain,
  '#/workout': renderWorkout,
  '#/body': renderBody,
  '#/progress': renderProgress,
  '#/coach': renderCoach,
  '#/formcheck': renderFormCheck,
  '#/settings': renderSettings,
};

const NAV = [
  ['#/today', 'Today', 'flame'],
  ['#/food', 'Food', 'utensils'],
  ['#/train', 'Train', 'barbell'],
  ['#/progress', 'Progress', 'chart'],
  ['#/coach', 'Coach', 'sparkles'],
];

export const App = {
  boot: null,
  root: null,
  viewEl: null,
  navEl: null,

  applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'light' ? '#F4F5F1' : '#0B0C0F';
  },

  async refresh() {
    this.boot = await api(`/bootstrap?today=${todayStr()}`);
    setUnits(this.boot.settings);
    this.applyTheme(this.boot.settings.theme);
    return this.boot;
  },

  go(hash) {
    if (location.hash === hash) this.route();
    else location.hash = hash;
  },

  // called when onboarding completes
  async start() {
    await this.refresh();
    this.buildShell();
    if (location.hash === '#/today') this.route();
    else location.hash = '#/today'; // hashchange listener routes
  },

  buildShell() {
    this.root.replaceChildren();
    this.viewEl = h('div', {});
    this.navEl = h('nav', { class: 'bottomnav' });
    this.root.append(this.viewEl, this.navEl);
    this.renderNav();
  },

  renderNav() {
    let current = location.hash || '#/today';
    // live workouts, the body map and form checks live under the Train tab
    if (current.startsWith('#/workout') || current.startsWith('#/formcheck') || current.startsWith('#/body')) current = '#/train';
    this.navEl.replaceChildren(...NAV.map(([hash, label, icon]) =>
      h('button', { class: current.startsWith(hash) ? 'active' : '', onclick: () => this.go(hash) },
        ico(icon), label)));
  },

  route() {
    const hash = location.hash || '#/today';
    const fn = routes[hash.split('?')[0]] || renderToday;
    this.renderNav();
    this.viewEl.replaceChildren();
    window.scrollTo(0, 0);
    Promise.resolve(fn(this.viewEl)).catch((e) => {
      console.error(e);
      toast(e.message || 'Something went wrong.', 'bad');
    });
  },
};

async function main() {
  App.root = document.getElementById('app');
  try {
    await App.refresh();
  } catch (e) {
    App.root.replaceChildren(
      h('div', { class: 'boot-splash' },
        h('div', { class: 'boot-word' }, 'ASCEND'),
        h('p', { class: 'muted small center', style: { maxWidth: '280px' } },
          e.message || 'Could not reach the Ascend server. Make sure it’s running on your PC (npm start) and that you’re on the same Wi-Fi.'),
        h('button', { class: 'btn btn--primary', onclick: () => location.reload() }, 'Retry')));
    return;
  }

  if (!App.boot.onboarded) {
    renderOnboarding(App.root);
    return;
  }

  App.buildShell();
  if (!location.hash || !routes[location.hash.split('?')[0]]) location.hash = '#/today';
  App.route();
}

addEventListener('hashchange', () => {
  if (App.boot?.onboarded && App.viewEl) App.route();
});

main();
