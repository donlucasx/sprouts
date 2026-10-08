import { beforeEach } from "vitest";
import { clearSharedReads } from "@/lib/memo";

// The shared-read memo is module state: each test starts from fresh reads so its mocks and repo rows are what the route sees.
beforeEach(() => clearSharedReads());
