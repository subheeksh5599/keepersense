import React, { useEffect, useState } from 'react';
import Landing from './Landing';
import PipelineView from './PipelineView';

function getRoute() {
  const h = window.location.hash;
  return h.startsWith('#/app') ? 'app' : 'landing';
}

export default function App() {
  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    const onHash = () => {
      setRoute(getRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return route === 'app' ? <PipelineView /> : <Landing />;
}
