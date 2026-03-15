import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, agents } from "@/lib/db/schema";
import { eq, count, desc } from "drizzle-orm";
import { createProjectSchema } from "@/lib/validations/project";

export async function GET() {
  try {
    const allProjects = await db.select().from(projects).orderBy(desc(projects.createdAt));

    const result = await Promise.all(
      allProjects.map(async (project) => {
        const agentCountResult = await db
          .select({ count: count() })
          .from(agents)
          .where(eq(agents.projectId, project.id));

        return {
          id: project.id,
          name: project.name,
          description: project.description,
          agentCount: agentCountResult[0]?.count || 0,
          createdAt: project.createdAt.toISOString(),
          updatedAt: project.updatedAt.toISOString(),
        };
      })
    );

    return NextResponse.json({ projects: result });
  } catch (error) {
    console.error("Error loading projects:", error);
    return NextResponse.json({ error: "Failed to load projects" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = createProjectSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    // Check uniqueness
    const existing = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.name, parsed.data.name))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "A project with this name already exists" },
        { status: 409 }
      );
    }

    const [project] = await db
      .insert(projects)
      .values({
        name: parsed.data.name,
        description: parsed.data.description || null,
      })
      .returning();

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error("Error creating project:", error);
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}
