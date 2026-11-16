import type { ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva("ll-button", {
  variants: {
    variant: { primary: "ll-primary", outline: "ll-outline", ghost: "ll-ghost" },
    size: { default: "", small: "ll-small", icon: "ll-icon" },
  },
  defaultVariants: { variant: "primary", size: "default" },
});

export function Button({ asChild, variant, size, className, type, ...props }:
  ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} type={asChild ? undefined : type ?? "button"} {...props} />;
}
