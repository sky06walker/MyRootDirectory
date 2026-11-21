import React, { useState } from 'react';

interface TwinAvatarProps {
  /** Content hash of the custom avatar saved in the admin page; empty = built-in picture. */
  hash?: string | null;
  size: 64 | 52 | 40 | 28;
  className?: string;
}

/**
 * The avatar picture. A custom one (served as /api/twin/avatar?h=<hash>, immutable per picture)
 * wins; if it fails to load for any reason, the built-in picture is shown instead.
 */
export const TwinAvatar: React.FC<TwinAvatarProps> = ({ hash, size, className }) => {
  const [failedHash, setFailedHash] = useState<string | null>(null);

  if (hash && failedHash !== hash) {
    return (
      <img
        src={`/api/twin/avatar?h=${encodeURIComponent(hash)}`}
        width={size}
        height={size}
        alt=""
        className={className}
        decoding="async"
        onError={() => setFailedHash(hash)}
      />
    );
  }

  const sources =
    size === 64
      ? { webp: '/twin/avatar-64.webp 1x, /twin/avatar-128.webp 2x, /twin/avatar-192.webp 3x', png: '/twin/avatar-64.png 1x, /twin/avatar-128.png 2x, /twin/avatar-192.png 3x' }
      : { webp: '/twin/avatar-64.webp 1x, /twin/avatar-128.webp 2x', png: '/twin/avatar-64.png 1x, /twin/avatar-128.png 2x' };
  return (
    <picture>
      <source type="image/webp" srcSet={sources.webp} />
      <img
        src="/twin/avatar-128.png"
        srcSet={sources.png}
        width={size}
        height={size}
        alt=""
        className={className}
        decoding="async"
        fetchPriority={size === 64 ? 'low' : undefined}
      />
    </picture>
  );
};
