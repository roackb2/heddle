import { useEffect, useState } from 'react';

const MOBILE_QUERY = '(max-width: 760px)';

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => getQueryMatch(MOBILE_QUERY));

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_QUERY);
    const updateMatch = () => setIsMobile(mediaQuery.matches);

    updateMatch();
    mediaQuery.addEventListener('change', updateMatch);
    return () => {
      mediaQuery.removeEventListener('change', updateMatch);
    };
  }, []);

  return isMobile;
}

function getQueryMatch(query: string) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia(query).matches;
}
