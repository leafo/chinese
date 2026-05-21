export function AudioPlayIcon({ loading, playing }) {
  if (loading) {
    return '...';
  }

  if (playing) {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10">
        <rect width="10" height="10" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg width="10" height="10" viewBox="0 0 10 10">
      <polygon points="0,0 10,5 0,10" fill="currentColor" />
    </svg>
  );
}
