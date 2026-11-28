"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  githubListPostRepoPaths,
  githubTryCreatePost,
  isGitHubContentEnabled,
} from "@/lib/github-content";
import { registerDocInTreeBestEffort } from "@/lib/content-persist";
import {
  buildLabCapturePost,
  createLabCaptureDraft,
  type LabCaptureKind,
} from "@/lib/lab-capture";
import { getPostSlugs, tryCreatePost, type PostInput } from "@/lib/posts";
import { getSession } from "@/lib/session";

/**
 * Lab → knowledge-base draft note.
 * Form fields: kind, title, summary, sourceUrl, idHint, folder, returnTo,
 * optional extraArxiv / extraPdf.
 */
export async function captureLabNoteAction(formData: FormData) {
  const returnTo = String(formData.get("returnTo") ?? "/lab/papers").trim() ||
    "/lab/papers";
  const session = await getSession();
  if (!session) {
    redirect(`/login?from=${encodeURIComponent(returnTo)}`);
  }

  if (process.env.VERCEL && !isGitHubContentEnabled()) {
    redirect(
      `${returnTo}${returnTo.includes("?") ? "&" : "?"}captureError=no-github`,
    );
  }

  const kind = String(formData.get("kind") ?? "feed") as LabCaptureKind;
  const title = String(formData.get("title") ?? "").trim();
  const summary = String(formData.get("summary") ?? "").trim();
  const sourceUrl = String(formData.get("sourceUrl") ?? "").trim();
  const idHint = String(formData.get("idHint") ?? "").trim();
  const folder = String(formData.get("folder") ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  const authors = String(formData.get("authors") ?? "").trim();
  const extraArxiv = String(formData.get("extraArxiv") ?? "").trim();
  const extraPdf = String(formData.get("extraPdf") ?? "").trim();

  if (!title || !sourceUrl) {
    redirect(
      `${returnTo}${returnTo.includes("?") ? "&" : "?"}captureError=missing`,
    );
  }

  const extraLinks: { label: string; url: string }[] = [];
  if (extraArxiv) extraLinks.push({ label: "arXiv", url: extraArxiv });
  if (extraPdf) extraLinks.push({ label: "PDF", url: extraPdf });

  const built = buildLabCapturePost({
    kind: kind === "paper" ? "paper" : "feed",
    title,
    summary,
    sourceUrl,
    idHint: idHint || undefined,
    folder: folder || undefined,
    authors: authors || undefined,
    extraLinks,
  });

  const useGitHub = isGitHubContentEnabled();
  let input: PostInput;
  try {
    const slugs = useGitHub
      ? (await githubListPostRepoPaths()).map((p) => p.split("/").pop()!.slice(0, -3))
      : getPostSlugs();
    input = await createLabCaptureDraft(
      built,
      new Set(slugs),
      useGitHub ? githubTryCreatePost : tryCreatePost,
    );
  } catch (err) {
    console.error("captureLabNote failed:", err);
    redirect(
      `${returnTo}${returnTo.includes("?") ? "&" : "?"}captureError=write`,
    );
  }

  await registerDocInTreeBestEffort(input.slug, input.folder);
  revalidatePath("/admin");
  revalidatePath("/blog");
  revalidatePath("/kb");
  revalidatePath(`/admin/posts/${input.slug}/edit`);

  const q = new URLSearchParams({ saved: "1", created: "1" });
  if (useGitHub) q.set("via", "github");
  redirect(`/admin/posts/${encodeURIComponent(input.slug)}/edit?${q}`);
}
