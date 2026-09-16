import { useAnimatedAmount } from "../hooks/use-animated-amount";
import { formatCOP } from "../lib/format";

interface AnimatedPriceProps {
  amountCents: number;
  className?: string;
}

/** A peso amount that rolls to its new value when the billing period changes. */
export function AnimatedPrice({ amountCents, className }: AnimatedPriceProps) {
  const displayCents = useAnimatedAmount(amountCents);

  return <span className={className}>{formatCOP(displayCents)}</span>;
}
