"""ProjectReef MCP Server — stdio transport for Claude Desktop.

Configure in claude_desktop_config.json:
{
  "projectreef": {
    "command": "python",
    "args": ["/path/to/mcp_server.py"],
    "env": {
      "PROJECTREEF_URL": "http://192.168.x.x:8000",
      "PROJECTREEF_TOKEN": "your-api-token"
    }
  }
}
"""

import os
import sys
import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp import types

BASE_URL = os.getenv("PROJECTREEF_URL", "http://localhost:8000")
TOKEN = os.getenv("PROJECTREEF_TOKEN", "")

server = Server("projectreef")


def _headers() -> dict:
    return {"X-API-Token": TOKEN, "Content-Type": "application/json"}


def _get(path: str, params: dict = None) -> dict | list:
    with httpx.Client(base_url=BASE_URL, headers=_headers(), timeout=10) as client:
        r = client.get(path, params=params)
        r.raise_for_status()
        return r.json()


def _post(path: str, body: dict = None) -> dict | list:
    with httpx.Client(base_url=BASE_URL, headers=_headers(), timeout=10) as client:
        r = client.post(path, json=body or {})
        r.raise_for_status()
        return r.json()


def _patch(path: str, body: dict) -> dict:
    with httpx.Client(base_url=BASE_URL, headers=_headers(), timeout=10) as client:
        r = client.patch(path, json=body)
        r.raise_for_status()
        return r.json()


def _delete(path: str) -> None:
    with httpx.Client(base_url=BASE_URL, headers=_headers(), timeout=10) as client:
        r = client.delete(path)
        r.raise_for_status()


def _fmt(data) -> str:
    import json
    return json.dumps(data, indent=2, default=str)


@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="list_inbox",
            description="List unsorted tasks in the inbox",
            inputSchema={
                "type": "object",
                "properties": {
                    "filter": {"type": "string", "enum": ["all", "today", "overdue"], "default": "all"}
                },
            },
        ),
        types.Tool(
            name="list_tasks",
            description="List tasks with optional filters",
            inputSchema={
                "type": "object",
                "properties": {
                    "project_id": {"type": "string"},
                    "priority": {"type": "string", "enum": ["high", "normal", "low"]},
                    "due": {"type": "string", "enum": ["overdue", "today", "upcoming"]},
                    "completed": {"type": "boolean"},
                },
            },
        ),
        types.Tool(
            name="create_task",
            description="Create a single task (NLP parses dates from raw_input)",
            inputSchema={
                "type": "object",
                "properties": {
                    "raw_input": {"type": "string", "description": "Natural language task, e.g. 'Buy milk tomorrow 10:00'"},
                    "project_id": {"type": "string"},
                    "priority": {"type": "string", "enum": ["high", "normal", "low"]},
                    "parent_task_id": {"type": "string", "description": "ID of parent task to create a sub-task"},
                    "recurrence": {"type": "string", "description": "Recurrence rule, e.g. 'daily', 'weekly', 'monthly'"},
                },
                "required": ["raw_input"],
            },
        ),
        types.Tool(
            name="bulk_create_tasks",
            description="Create multiple tasks from an array of strings (brain dump)",
            inputSchema={
                "type": "object",
                "properties": {
                    "lines": {"type": "array", "items": {"type": "string"}},
                    "project_id": {"type": "string"},
                },
                "required": ["lines"],
            },
        ),
        types.Tool(
            name="update_task",
            description="Update task fields",
            inputSchema={
                "type": "object",
                "properties": {
                    "task_id": {"type": "string"},
                    "title": {"type": "string"},
                    "notes": {"type": "string"},
                    "project_id": {"type": "string"},
                    "priority": {"type": "string", "enum": ["high", "normal", "low"]},
                    "bucket_id": {"type": "string"},
                    "due_at": {"type": "string", "description": "ISO 8601 datetime, e.g. '2025-06-15T14:00:00Z'"},
                    "recurrence": {"type": "string", "description": "Recurrence rule, e.g. 'daily', 'weekly', 'monthly', or null to clear"},
                },
                "required": ["task_id"],
            },
        ),
        types.Tool(
            name="complete_task",
            description="Mark a task as completed",
            inputSchema={
                "type": "object",
                "properties": {"task_id": {"type": "string"}},
                "required": ["task_id"],
            },
        ),
        types.Tool(
            name="uncomplete_task",
            description="Mark a completed task as open again",
            inputSchema={
                "type": "object",
                "properties": {"task_id": {"type": "string"}},
                "required": ["task_id"],
            },
        ),
        types.Tool(
            name="delete_task",
            description="Permanently delete a task",
            inputSchema={
                "type": "object",
                "properties": {"task_id": {"type": "string"}},
                "required": ["task_id"],
            },
        ),
        types.Tool(
            name="add_comment",
            description="Add a comment to a task",
            inputSchema={
                "type": "object",
                "properties": {
                    "task_id": {"type": "string"},
                    "body": {"type": "string"},
                },
                "required": ["task_id", "body"],
            },
        ),
        types.Tool(
            name="list_projects",
            description="List all projects (tree structure)",
            inputSchema={"type": "object", "properties": {}},
        ),
        types.Tool(
            name="get_project",
            description="Get a project with its tasks, goals, and buckets",
            inputSchema={
                "type": "object",
                "properties": {"project_id": {"type": "string"}},
                "required": ["project_id"],
            },
        ),
        types.Tool(
            name="get_dashboard",
            description="Get rolled-up metrics for a project and all subprojects",
            inputSchema={
                "type": "object",
                "properties": {"project_id": {"type": "string"}},
                "required": ["project_id"],
            },
        ),
        types.Tool(
            name="create_project",
            description="Create a new project or subproject",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                    "parent_id": {"type": "string"},
                },
                "required": ["name"],
            },
        ),
        types.Tool(
            name="archive_project",
            description="Archive a project and all its subprojects",
            inputSchema={
                "type": "object",
                "properties": {"project_id": {"type": "string"}},
                "required": ["project_id"],
            },
        ),
        types.Tool(
            name="list_goals",
            description="List goals for a project",
            inputSchema={
                "type": "object",
                "properties": {"project_id": {"type": "string"}},
                "required": ["project_id"],
            },
        ),
        types.Tool(
            name="create_goal",
            description="Create a goal for a project",
            inputSchema={
                "type": "object",
                "properties": {
                    "project_id": {"type": "string"},
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                },
                "required": ["project_id", "title"],
            },
        ),
        types.Tool(
            name="complete_goal",
            description="Mark a goal as completed",
            inputSchema={
                "type": "object",
                "properties": {"goal_id": {"type": "string"}},
                "required": ["goal_id"],
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    try:
        if name == "list_inbox":
            data = _get("/api/tasks/inbox", {"filter": arguments.get("filter", "all")})
        elif name == "list_tasks":
            data = _get("/api/tasks", {k: v for k, v in arguments.items() if v is not None})
        elif name == "create_task":
            data = _post("/api/tasks", arguments)
        elif name == "bulk_create_tasks":
            data = _post("/api/tasks/bulk", arguments)
        elif name == "update_task":
            task_id = arguments.pop("task_id")
            data = _patch(f"/api/tasks/{task_id}", arguments)
        elif name == "complete_task":
            data = _post(f"/api/tasks/{arguments['task_id']}/complete")
        elif name == "uncomplete_task":
            data = _post(f"/api/tasks/{arguments['task_id']}/uncomplete")
        elif name == "delete_task":
            _delete(f"/api/tasks/{arguments['task_id']}")
            data = {"deleted": arguments['task_id']}
        elif name == "add_comment":
            task_id = arguments["task_id"]
            data = _post(f"/api/tasks/{task_id}/comments", {"body": arguments["body"]})
        elif name == "list_projects":
            data = _get("/api/projects")
        elif name == "get_project":
            data = _get(f"/api/projects/{arguments['project_id']}")
        elif name == "get_dashboard":
            data = _get(f"/api/projects/{arguments['project_id']}/dashboard")
        elif name == "create_project":
            data = _post("/api/projects", arguments)
        elif name == "archive_project":
            data = _post(f"/api/projects/{arguments['project_id']}/archive")
        elif name == "list_goals":
            data = _get(f"/api/projects/{arguments['project_id']}/goals")
        elif name == "create_goal":
            project_id = arguments.pop("project_id")
            data = _post(f"/api/projects/{project_id}/goals", arguments)
        elif name == "complete_goal":
            data = _post(f"/api/goals/{arguments['goal_id']}/complete")
        else:
            data = {"error": f"Unknown tool: {name}"}

        return [types.TextContent(type="text", text=_fmt(data))]

    except httpx.HTTPStatusError as e:
        return [types.TextContent(type="text", text=f"API error {e.response.status_code}: {e.response.text}")]
    except Exception as e:
        return [types.TextContent(type="text", text=f"Error: {e}")]


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
