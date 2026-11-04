/** Three pixel star layers that drift at different speeds, a nod to PARALLAXIA. Decorative only. */
export function Starfield() {
  return (
    <div className="starfield" aria-hidden="true">
      <span className="starfield__layer starfield__layer--far" />
      <span className="starfield__layer starfield__layer--mid" />
      <span className="starfield__layer starfield__layer--near" />
    </div>
  );
}
