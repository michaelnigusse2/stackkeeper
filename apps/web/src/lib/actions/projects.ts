"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FormReader } from "@stackkeeper/core";
import { createProject, recordAudit, softDeleteProject, updateProject } from "@stackkeeper/db";
import type { ProjectStatus } from "@stackkeeper/db";
import { withPrincipal } from "@/lib/session";
import { failed, invalid, type FormState } from "./state";

const STATUSES = [
  "planning", "active", "maintenance", "handed_over", "archived",
] as const satisfies readonly ProjectStatus[];

function read(formData: FormData) {
  const reader = FormReader.fromFormData(formData);
  const input = {
    clientId: reader.uuid("clientId", "Client") ?? "",
    name: reader.requiredText("name", "Project name", { max: 200 }),
    status: reader.choice("status", "Status", STATUSES, "active"),
    description: reader.optionalText("description", "Description", { max: 5000 }),
    repoUrl: reader.url("repoUrl", "Repository URL"),
    liveUrl: reader.url("liveUrl", "Live URL"),
  };
  return { reader, input };
}

export async function createProjectAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { reader, input } = read(formData);
  if (!reader.valid) return invalid(reader.errors);

  try {
    await withPrincipal(async (tx, principal) => {
      const project = await createProject(tx, principal.orgId, input);
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "project.created",
        targetType: "project",
        targetId: project.id,
        data: { name: project.name },
      });
    });
  } catch (error) {
    return failed(error, "The project could not be saved.");
  }

  revalidatePath("/projects");
  revalidatePath(`/clients/${input.clientId}`);
  redirect(`/clients/${input.clientId}`);
}

export async function updateProjectAction(
  projectId: string,
  clientId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { reader, input } = read(formData);
  if (!reader.valid) return invalid(reader.errors);

  try {
    await withPrincipal(async (tx, principal) => {
      await updateProject(tx, projectId, input);
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "project.updated",
        targetType: "project",
        targetId: projectId,
      });
    });
  } catch (error) {
    return failed(error, "The project could not be saved.");
  }

  revalidatePath("/projects");
  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}`);
}

export async function deleteProjectAction(projectId: string, clientId: string): Promise<void> {
  await withPrincipal(async (tx, principal) => {
    const removed = await softDeleteProject(tx, projectId);
    if (removed) {
      await recordAudit(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "project.deleted",
        targetType: "project",
        targetId: projectId,
      });
    }
  });
  revalidatePath("/projects");
  revalidatePath(`/clients/${clientId}`);
}
