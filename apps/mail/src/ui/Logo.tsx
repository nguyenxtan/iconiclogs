/** Preserve the original full logo and the shared original-mark asset. */
export function Logo({ markOnly = false }: { markOnly?: boolean }) {
  return (
    <span className={`brand-logo ${markOnly ? 'brand-logo-mark' : 'brand-logo-full'}`}>
      <img
        src={markOnly ? '/brand/mark.svg' : '/brand/iconic-logo.png'}
        alt="ICONIC Logistics"
        width={markOnly ? 240 : 500}
        height={markOnly ? 250 : 500}
      />
    </span>
  );
}
