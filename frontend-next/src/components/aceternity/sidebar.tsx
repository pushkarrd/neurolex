"use client";

import React, { useEffect, useState, createContext, useContext } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link, { LinkProps } from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Menu, X } from "lucide-react";

interface Links {
  label: string;
  href: string;
  icon: React.JSX.Element | React.ReactNode;
}

interface SidebarContextProps {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  animate: boolean;
}

const SidebarContext = createContext<SidebarContextProps | undefined>(undefined);

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
};

export const SidebarProvider = ({
  children,
  open: openProp,
  setOpen: setOpenProp,
  animate = true,
}: {
  children: React.ReactNode;
  open?: boolean;
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  animate?: boolean;
}) => {
  const [openState, setOpenState] = useState(false);
  const open = openProp !== undefined ? openProp : openState;
  const setOpen = setOpenProp !== undefined ? setOpenProp : setOpenState;

  return (
    <SidebarContext.Provider value={{ open, setOpen, animate }}>
      {children}
    </SidebarContext.Provider>
  );
};

export const Sidebar = ({
  children,
  open,
  setOpen,
  animate,
}: {
  children: React.ReactNode;
  open?: boolean;
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  animate?: boolean;
}) => {
  return (
    <SidebarProvider open={open} setOpen={setOpen} animate={animate}>
      {children}
    </SidebarProvider>
  );
};

export const SidebarBody = (props: React.ComponentProps<typeof motion.div>) => {
  return (
    <>
      <DesktopSidebar {...props} />
      <MobileSidebar {...(props as unknown as React.ComponentProps<"div">)} />
    </>
  );
};

export const DesktopSidebar = ({
  className,
  children,
  ...props
}: React.ComponentProps<typeof motion.div>) => {
  const { open, setOpen, animate } = useSidebar();

  const handleMouseEnter = () => {
    setOpen(true);
  };

  const handleMouseMove = () => {
    if (!open) {
      setOpen(true);
    }
  };

  const handleMouseLeave = () => {
    setOpen(false);
  };

  return (
    <motion.div
      className={cn(
        "relative z-40 h-full px-4 py-4 hidden md:flex md:flex-col shrink-0 overflow-hidden",
        "glass border-r border-border",
        className
      )}
      animate={{
        width: animate ? (open ? "320px" : "72px") : "320px",
      }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      {children}
    </motion.div>
  );
};

export const MobileSidebar = ({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) => {
  const { open, setOpen } = useSidebar();
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname, setOpen]);

  return (
    <>
      <div
        className={cn(
          "sticky top-0 z-40 h-14 px-4 flex flex-row md:hidden items-center justify-between w-full shrink-0",
          "bg-background/80 backdrop-blur-xl border-b border-border"
        )}
        {...props}
      >
        <div className="text-sm font-semibold text-foreground/80">Menu</div>
        <div className="flex justify-end z-20">
          <button
            onClick={() => setOpen(!open)}
            className="text-foreground p-2 rounded-lg hover:bg-accent/70 transition-colors duration-200"
            aria-label={open ? "Close sidebar" : "Open sidebar"}
            aria-expanded={open}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <>
            <motion.button
              type="button"
              aria-label="Close sidebar overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-90 bg-black/45 backdrop-blur-[1px] md:hidden"
            />

            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.28, ease: "easeInOut" }}
              className={cn(
                "fixed inset-y-0 left-0 z-100 w-[84vw] max-w-88 md:hidden",
                "bg-background/95 backdrop-blur-xl border-r border-border",
                "px-4 pt-4 pb-6",
                className
              )}
            >
              <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
                <span className="text-sm font-semibold text-foreground/90">NeuroLex Menu</span>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close sidebar"
                  className="rounded-lg p-2 text-foreground hover:bg-accent/70 transition-colors duration-200"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="h-[calc(100dvh-5rem)] overflow-y-auto pr-1">{children}</div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export const SidebarLink = ({
  link,
  className,
  active,
  ...props
}: {
  link: Links;
  className?: string;
  active?: boolean;
  props?: LinkProps;
}) => {
  const { open, setOpen, animate } = useSidebar();
  return (
    <Link
      href={link.href}
      onClick={() => {
        if (typeof window !== "undefined" && window.innerWidth < 768) {
          setOpen(false);
        }
      }}
      className={cn(
        "flex items-center justify-start gap-2 group/sidebar py-2 px-2 rounded-lg transition-colors duration-200",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-accent",
        className
      )}
      {...props}
    >
      <span className="shrink-0">{link.icon}</span>
      {(open || !animate) && (
        <span className="text-sm font-semibold whitespace-nowrap group-hover/sidebar:translate-x-1 transition duration-150">
          {link.label}
        </span>
      )}
    </Link>
  );
};
