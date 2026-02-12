/**
 * Template editor for creating/editing/deleting custom site templates.
 * 
 * Provides a form-based UI for editing templates with JSON import/export support.
 */

import type { SiteTemplate, TemplateSelectors } from "../shared/templates";
import { getEl, showStatus, escapeHtml } from "./ui";

// Track currently editing template index (-1 = new template)
let editingIndex: number = -1;

// Store reference to the settings templates array and save callback
let templatesRef: SiteTemplate[] = [];
let onSaveCallback: (() => Promise<void>) | null = null;

/**
 * Initialize the template editor with a reference to templates and save callback.
 */
export function initTemplateEditor(
  templates: SiteTemplate[],
  onSave: () => Promise<void>
): void {
  templatesRef = templates;
  onSaveCallback = onSave;
}

/**
 * Create a blank template with default values.
 */
function createBlankTemplate(): SiteTemplate {
  return {
    domain: "",
    name: "",
    selectors: {
      title: "",
      content: "",
      author: "",
      date: "",
      tags: "",
      description: "",
      url: "",
      image: ""
    },
    removeSelectors: [],
    frontmatterExtras: {},
    enabled: true,
    priority: 0,
    description: ""
  };
}

/**
 * Render the list of custom templates.
 */
export function renderCustomTemplates(templates: SiteTemplate[]): void {
  const container = getEl<HTMLDivElement>("customTemplatesList");
  if (!container) return;

  // Update reference
  templatesRef = templates;

  container.innerHTML = "";

  if (templates.length === 0) {
    container.innerHTML = '<p class="empty-state">No custom templates yet. Click "Add Template" to create one.</p>';
    return;
  }

  for (let i = 0; i < templates.length; i++) {
    const template = templates[i] as SiteTemplate;
    const div = document.createElement("div");
    div.className = "template-item";
    div.innerHTML = `
      <div class="template-info">
        <span class="template-name ${!template.enabled ? "disabled" : ""}">${escapeHtml(template.name || "Unnamed")}</span>
        <span class="template-domain">${escapeHtml(template.domain)}</span>
        ${!template.enabled ? '<span class="template-status">Disabled</span>' : ""}
      </div>
      <div class="template-actions">
        <button class="template-edit-btn" data-index="${i}" title="Edit template">Edit</button>
        <button class="template-duplicate-btn" data-index="${i}" title="Duplicate template">Duplicate</button>
        <button class="template-delete-btn" data-index="${i}" title="Delete template">Delete</button>
      </div>
    `;
    container.appendChild(div);
  }

  // Attach event listeners
  container.querySelectorAll<HTMLButtonElement>(".template-edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = parseInt(btn.dataset.index || "-1", 10);
      openTemplateEditor(index);
    });
  });

  container.querySelectorAll<HTMLButtonElement>(".template-duplicate-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = parseInt(btn.dataset.index || "-1", 10);
      void duplicateTemplate(index);
    });
  });

  container.querySelectorAll<HTMLButtonElement>(".template-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = parseInt(btn.dataset.index || "-1", 10);
      void deleteTemplate(index);
    });
  });
}

/**
 * Open the template editor modal for creating or editing a template.
 */
export function openTemplateEditor(index: number): void {
  const modal = getEl<HTMLDivElement>("templateModal");
  const form = getEl<HTMLFormElement>("templateForm");
  if (!modal || !form) return;

  editingIndex = index;
  const template = index >= 0 ? (templatesRef[index] as SiteTemplate) : createBlankTemplate();

  // Populate form fields
  (getEl<HTMLInputElement>("templateDomain") as HTMLInputElement).value = template.domain || "";
  (getEl<HTMLInputElement>("templateName") as HTMLInputElement).value = template.name || "";
  (getEl<HTMLInputElement>("templateEnabled") as HTMLInputElement).checked = template.enabled !== false;
  (getEl<HTMLInputElement>("templatePriority") as HTMLInputElement).value = String(template.priority ?? 0);
  (getEl<HTMLInputElement>("templateDescription") as HTMLInputElement).value = template.description || "";
  (getEl<HTMLInputElement>("templateUrlPattern") as HTMLInputElement).value = template.urlPattern || "";

  // Selectors
  (getEl<HTMLInputElement>("selectorTitle") as HTMLInputElement).value = template.selectors?.title || "";
  (getEl<HTMLInputElement>("selectorContent") as HTMLInputElement).value = template.selectors?.content || "";
  (getEl<HTMLInputElement>("selectorAuthor") as HTMLInputElement).value = template.selectors?.author || "";
  (getEl<HTMLInputElement>("selectorDate") as HTMLInputElement).value = template.selectors?.date || "";
  (getEl<HTMLInputElement>("selectorTags") as HTMLInputElement).value = template.selectors?.tags || "";
  (getEl<HTMLInputElement>("selectorDescription") as HTMLInputElement).value = template.selectors?.description || "";
  (getEl<HTMLInputElement>("selectorUrl") as HTMLInputElement).value = template.selectors?.url || "";
  (getEl<HTMLInputElement>("selectorImage") as HTMLInputElement).value = template.selectors?.image || "";

  // Remove selectors (one per line)
  (getEl<HTMLTextAreaElement>("templateRemoveSelectors") as HTMLTextAreaElement).value = 
    (template.removeSelectors || []).join("\n");

  // Frontmatter extras (JSON)
  (getEl<HTMLTextAreaElement>("templateFrontmatter") as HTMLTextAreaElement).value = 
    JSON.stringify(template.frontmatterExtras || {}, null, 2);

  // Update modal title
  const modalTitle = getEl<HTMLHeadingElement>("templateModalTitle");
  if (modalTitle) {
    modalTitle.textContent = index >= 0 ? "Edit Template" : "Add New Template";
  }

  // Show modal
  modal.classList.add("visible");
  
  // Focus first field
  (getEl<HTMLInputElement>("templateDomain") as HTMLInputElement)?.focus();
}

/**
 * Close the template editor modal.
 */
export function closeTemplateEditor(): void {
  const modal = getEl<HTMLDivElement>("templateModal");
  if (modal) {
    modal.classList.remove("visible");
  }
  editingIndex = -1;
}

/**
 * Collect form data into a SiteTemplate object.
 */
function collectTemplateFromForm(): SiteTemplate | null {
  const domain = (getEl<HTMLInputElement>("templateDomain")?.value || "").trim();
  const name = (getEl<HTMLInputElement>("templateName")?.value || "").trim();

  // Validate required fields
  if (!domain) {
    showStatus("error", "Domain is required");
    return null;
  }
  if (!name) {
    showStatus("error", "Template name is required");
    return null;
  }

  // Parse remove selectors
  const removeSelectorsText = getEl<HTMLTextAreaElement>("templateRemoveSelectors")?.value || "";
  const removeSelectors = removeSelectorsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  // Parse frontmatter extras
  let frontmatterExtras: Record<string, string> = {};
  const frontmatterText = getEl<HTMLTextAreaElement>("templateFrontmatter")?.value || "";
  if (frontmatterText.trim()) {
    try {
      const parsed = JSON.parse(frontmatterText);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        frontmatterExtras = parsed as Record<string, string>;
      } else {
        showStatus("error", "Frontmatter extras must be a JSON object");
        return null;
      }
    } catch {
      showStatus("error", "Invalid JSON in frontmatter extras");
      return null;
    }
  }

  // Build selectors object
  const selectors: TemplateSelectors = {
    title: (getEl<HTMLInputElement>("selectorTitle")?.value || "").trim() || undefined,
    content: (getEl<HTMLInputElement>("selectorContent")?.value || "").trim() || undefined,
    author: (getEl<HTMLInputElement>("selectorAuthor")?.value || "").trim() || undefined,
    date: (getEl<HTMLInputElement>("selectorDate")?.value || "").trim() || undefined,
    tags: (getEl<HTMLInputElement>("selectorTags")?.value || "").trim() || undefined,
    description: (getEl<HTMLInputElement>("selectorDescription")?.value || "").trim() || undefined,
    url: (getEl<HTMLInputElement>("selectorUrl")?.value || "").trim() || undefined,
    image: (getEl<HTMLInputElement>("selectorImage")?.value || "").trim() || undefined
  };

  // Remove undefined entries
  for (const key of Object.keys(selectors) as (keyof TemplateSelectors)[]) {
    if (selectors[key] === undefined) {
      delete selectors[key];
    }
  }

  const priorityValue = parseInt(getEl<HTMLInputElement>("templatePriority")?.value || "0", 10);

  return {
    domain,
    name,
    enabled: getEl<HTMLInputElement>("templateEnabled")?.checked ?? true,
    priority: isNaN(priorityValue) ? 0 : priorityValue,
    description: (getEl<HTMLInputElement>("templateDescription")?.value || "").trim(),
    urlPattern: (getEl<HTMLInputElement>("templateUrlPattern")?.value || "").trim() || undefined,
    selectors,
    removeSelectors: removeSelectors.length > 0 ? removeSelectors : undefined,
    frontmatterExtras: Object.keys(frontmatterExtras).length > 0 ? frontmatterExtras : undefined
  };
}

/**
 * Save the current template from the editor form.
 */
async function saveTemplate(): Promise<void> {
  const template = collectTemplateFromForm();
  if (!template) return;

  if (editingIndex >= 0) {
    // Update existing template
    templatesRef[editingIndex] = template;
  } else {
    // Add new template
    templatesRef.push(template);
  }

  if (onSaveCallback) {
    await onSaveCallback();
  }
  renderCustomTemplates(templatesRef);
  closeTemplateEditor();
  showStatus("success", editingIndex >= 0 ? "Template updated" : "Template created");
}

/**
 * Delete a template.
 */
async function deleteTemplate(index: number): Promise<void> {
  const template = templatesRef[index] as SiteTemplate;
  const confirmed = window.confirm(
    `Delete template "${template?.name || "Unnamed"}"? This cannot be undone.`
  );
  if (!confirmed) return;

  templatesRef.splice(index, 1);
  
  if (onSaveCallback) {
    await onSaveCallback();
  }
  renderCustomTemplates(templatesRef);
  showStatus("success", "Template deleted");
}

/**
 * Duplicate a template.
 */
async function duplicateTemplate(index: number): Promise<void> {
  const original = templatesRef[index] as SiteTemplate;
  const copy: SiteTemplate = {
    ...original,
    name: `${original.name} (Copy)`,
    domain: original.domain
  };

  templatesRef.push(copy);
  
  if (onSaveCallback) {
    await onSaveCallback();
  }
  renderCustomTemplates(templatesRef);
  showStatus("success", "Template duplicated");
}

/**
 * Export templates to a JSON file.
 */
export function exportTemplates(): void {
  if (templatesRef.length === 0) {
    showStatus("error", "No custom templates to export");
    return;
  }

  const json = JSON.stringify(templatesRef, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `obsidian-web-clipper-templates-${new Date().toISOString().split("T")[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showStatus("success", `Exported ${templatesRef.length} template(s)`);
}

/**
 * Import templates from a JSON file.
 */
export function importTemplates(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const imported = JSON.parse(text) as unknown;

      // Validate structure
      if (!Array.isArray(imported)) {
        showStatus("error", "Invalid file: expected an array of templates");
        return;
      }

      // Validate each template has required fields
      const validTemplates: SiteTemplate[] = [];
      for (let i = 0; i < imported.length; i++) {
        const item = imported[i] as Record<string, unknown>;
        if (!item || typeof item !== "object") {
          showStatus("error", `Template ${i + 1}: invalid object`);
          return;
        }
        if (!item.domain || typeof item.domain !== "string") {
          showStatus("error", `Template ${i + 1}: missing or invalid "domain"`);
          return;
        }
        if (!item.name || typeof item.name !== "string") {
          showStatus("error", `Template ${i + 1}: missing or invalid "name"`);
          return;
        }

        // Ensure required fields
        validTemplates.push({
          domain: item.domain,
          name: item.name,
          enabled: typeof item.enabled === "boolean" ? item.enabled : true,
          priority: typeof item.priority === "number" ? item.priority : 0,
          description: typeof item.description === "string" ? item.description : undefined,
          urlPattern: typeof item.urlPattern === "string" ? item.urlPattern : undefined,
          selectors: (item.selectors as TemplateSelectors) || {},
          removeSelectors: Array.isArray(item.removeSelectors) 
            ? (item.removeSelectors as string[]) 
            : undefined,
          frontmatterExtras: typeof item.frontmatterExtras === "object" && item.frontmatterExtras !== null
            ? (item.frontmatterExtras as Record<string, string>)
            : undefined
        });
      }

      // Merge with existing (avoid duplicates by domain+name)
      const existingKeys = new Set(templatesRef.map((t) => `${t.domain}|${t.name}`));
      let added = 0;

      for (const template of validTemplates) {
        const key = `${template.domain}|${template.name}`;
        if (!existingKeys.has(key)) {
          templatesRef.push(template);
          added++;
        }
      }

      if (onSaveCallback) {
        await onSaveCallback();
      }
      renderCustomTemplates(templatesRef);
      showStatus("success", `Imported ${added} new template(s), skipped ${validTemplates.length - added} duplicate(s)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to parse JSON file";
      showStatus("error", message);
    }
  });

  input.click();
}

/**
 * Show JSON preview of a template.
 */
export function showJsonPreview(index: number): void {
  const template = templatesRef[index] as SiteTemplate;
  const preview = getEl<HTMLPreElement>("templateJsonPreview");
  if (preview) {
    preview.textContent = JSON.stringify(template, null, 2);
  }
}

/**
 * Set up event listeners for the template editor.
 */
export function setupTemplateEditor(
  templates: SiteTemplate[],
  onSave: () => Promise<void>
): void {
  // Initialize reference and callback
  initTemplateEditor(templates, onSave);

  // Add template button
  const addBtn = getEl<HTMLButtonElement>("addTemplateBtn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      openTemplateEditor(-1);
    });
  }

  // Export button
  const exportBtn = getEl<HTMLButtonElement>("exportTemplatesBtn");
  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      exportTemplates();
    });
  }

  // Import button
  const importBtn = getEl<HTMLButtonElement>("importTemplatesBtn");
  if (importBtn) {
    importBtn.addEventListener("click", () => {
      importTemplates();
    });
  }

  // Modal close button
  const closeBtn = getEl<HTMLButtonElement>("templateModalClose");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      closeTemplateEditor();
    });
  }

  // Modal cancel button
  const cancelBtn = getEl<HTMLButtonElement>("templateFormCancel");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      closeTemplateEditor();
    });
  }

  // Modal save button
  const saveBtn = getEl<HTMLButtonElement>("templateFormSave");
  if (saveBtn) {
    saveBtn.addEventListener("click", (e) => {
      e.preventDefault();
      void saveTemplate();
    });
  }

  // Close modal on backdrop click
  const modal = getEl<HTMLDivElement>("templateModal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        closeTemplateEditor();
      }
    });
  }

  // Close modal on Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal?.classList.contains("visible")) {
      closeTemplateEditor();
    }
  });

  // Form submit prevention (use save button instead)
  const form = getEl<HTMLFormElement>("templateForm");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void saveTemplate();
    });
  }
}
