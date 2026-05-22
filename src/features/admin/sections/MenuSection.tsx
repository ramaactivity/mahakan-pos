"use client";

import { useState } from "react";
import { Tab, TabList, TabPanel, Tabs } from "@/components/ui";
import { ItemsList } from "./menu/ItemsList";
import { CategoriesList } from "./menu/CategoriesList";
import { ModifiersConfig } from "./menu/ModifiersConfig";

type MenuTab = "items" | "categories" | "modifiers";

const TABS: Array<{ key: MenuTab; label: string }> = [
  { key: "items", label: "Items" },
  { key: "categories", label: "Kategori" },
  { key: "modifiers", label: "Modifier" },
];

export function MenuSection() {
  const [tab, setTab] = useState<MenuTab>("items");

  return (
    <Tabs
      value={tab}
      onChange={(v) => setTab(v as MenuTab)}
      className="p-6 space-y-4"
    >
      <header>
        <h1 className="text-2xl font-bold text-mahakan-green-900">
          Menu Management
        </h1>
        <p className="text-sm text-neutral-700">
          CRUD menu items, kategori, dan konfigurasi modifier.
        </p>
      </header>

      <TabList ariaLabel="Menu management tabs">
        {TABS.map((t) => (
          <Tab key={t.key} value={t.key}>
            {t.label}
          </Tab>
        ))}
      </TabList>

      <TabPanel value="items">
        <ItemsList />
      </TabPanel>
      <TabPanel value="categories">
        <CategoriesList />
      </TabPanel>
      <TabPanel value="modifiers">
        <ModifiersConfig />
      </TabPanel>
    </Tabs>
  );
}
