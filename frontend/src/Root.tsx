import { useEffect } from 'react';
import { Planner } from './planner/Planner';
import { useRoute } from './router';
import { About, NotFound } from './site/About';
import { Guide } from './site/Guide';
import { Home } from './site/Home';
import { Method } from './site/Method';
import { NewSearch } from './site/NewSearch';

const TITLES: Record<string, string> = {
  '/': 'Scent Cone: air-scent dog deployment planner',
  '/new': 'Plan a search · Scent Cone',
  '/planner': 'Planner · Scent Cone',
  '/how-it-works': 'How it works · Scent Cone',
  '/guide': 'Guide · Scent Cone',
  '/about': 'About · Scent Cone',
};

export function Root() {
  const { path, query } = useRoute();
  useEffect(() => {
    document.title = TITLES[path] ?? 'Not found · Scent Cone';
    // honour #anchors after client-side navigation
    if (location.hash) setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView(), 50);
  }, [path]);
  switch (path) {
    case '/':
      return <Home />;
    case '/new':
      return <NewSearch />;
    case '/planner':
      return <Planner query={query} />;
    case '/how-it-works':
      return <Method />;
    case '/guide':
      return <Guide />;
    case '/about':
      return <About />;
    default:
      return <NotFound />;
  }
}
