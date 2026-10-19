"use client";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return <Button size="sm" variant="primary" onClick={() => window.print()}><Printer className="h-3.5 w-3.5" />Print</Button>;
}
