import { useEffect, useState } from 'react';
import { cx } from './ui';

// A round avatar (#261): the picture when `src` loads, else the initials. The initials are always
// rendered underneath and the image is laid over them, transparent until it has loaded, so a slow
// or failing image never shows a broken icon or moves the layout.
const Avatar = ({ src, fallback, className }) => {
  const [state, setState] = useState('loading');
  useEffect(() => { setState('loading'); }, [src]);
  return (
    <span className={cx('relative grid place-items-center overflow-hidden rounded-full', className)}>
      {fallback}
      {src && state !== 'failed' && (
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
          className={cx('absolute inset-0 size-full rounded-full object-cover', state === 'loaded' ? 'opacity-100' : 'opacity-0')}
        />
      )}
    </span>
  );
};

export default Avatar;
