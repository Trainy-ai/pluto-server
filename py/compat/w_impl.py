from sgqlc.operation import Operation
from sgqlc.types import (
    ID,
    Boolean,
    Enum,
    Field,
    Input,
    Int,
    String,
    Type,
    Variable,
    list_of,
    non_null,
)


class JSONString(String):
    pass


class WorkflowsAdminType(Enum):
    __choices__ = ("MODEL",)


class Typename(Type):
    __typename = String


class User(Typename):
    id = non_null(ID)
    username = String
    email = String
    name = String
    admin = Boolean
    flags = list_of(String)
    entity = String
    photoUrl = String


class MemberRole(Type):
    ID = non_null(ID)
    name = String


class Member(Type):
    id = non_null(ID)
    admin = Boolean
    pending = Boolean
    email = String
    username = String
    name = String
    photoUrl = String
    accountType = String
    apiKey = String
    role = String
    memberRole = Field(MemberRole)


class ClaimingEntity(Type):
    id = non_null(ID)
    name = String


class ApiKey(Type):
    id = non_null(ID)
    name = String
    description = String


class ApiKeyEdge(Type):
    node = Field(ApiKey)


class ApiKeyConnection(Type):
    edges = list_of(ApiKeyEdge)


class Team(Type):
    name = String


class TeamEdge(Type):
    node = Field(Team)


class TeamConnection(Type):
    edges = list_of(TeamEdge)


class ProjectFragment(Type):
    id = non_null(ID)
    name = String
    entityName = String
    createdAt = String
    isBenchmark = Boolean


class Project(ProjectFragment):
    internalId = ID
    runCount = Field(Int, args={"filters": JSONString})
    readOnly = Boolean
    __typename = String


class Run(Typename):
    id = non_null(ID)
    tags = list_of(String)
    name = String
    displayName = String
    sweepName = String
    state = String
    config = JSONString
    group = String
    jobType = String
    commit = String
    readOnly = Boolean
    createdAt = String
    heartbeatAt = String
    updatedAt = String
    description = String
    notes = String
    systemMetrics = JSONString
    summaryMetrics = JSONString
    historyLineCount = Int
    history = Field(JSONString, args={"samples": Int})
    user = Field(User)
    project = Field(Project)
    groupCounts = JSONString
    historyKeys = list_of(String)


class RunEdge(Type):
    node = Field(Run)
    cursor = String


class PageInfo(Type):
    endCursor = String
    hasNextPage = Boolean


class RunConnection(Type):
    edges = list_of(RunEdge)
    pageInfo = Field(PageInfo)


class ProjectWithRuns(Project):
    runs = Field(
        RunConnection,
        args={"filters": JSONString, "after": String, "first": Int, "order": String},
    )
    run = Field(Run, args={"name": non_null(String)})


class InviteNode(Type):
    id = non_null(ID)
    email = String
    fromUser = Field(User)


class InviteEdge(Type):
    node = Field(InviteNode)


class InviteConnection(Type):
    edges = list_of(InviteEdge)


class ProjectNode(Type):
    id = non_null(ID)


class ProjectEdge(Type):
    node = Field(ProjectNode)


class ProjectConnection(Type):
    edges = list_of(ProjectEdge)


class WorkflowAdmin(Type):
    id = non_null(ID)
    username = String
    name = String
    email = String


class Entity(Type):
    available = Boolean
    claimingEntity = Field(ClaimingEntity)
    id = non_null(ID)
    isTeam = Boolean
    members = list_of(Member)
    memberCount = Int
    name = String
    organizationId = String
    invites = Field(InviteConnection)
    photoUrl = String
    projects = Field(ProjectConnection, args={"first": Int})
    projectCount = Int
    readOnly = Boolean
    workflowsAdmins = Field(
        list_of(WorkflowAdmin), args={"adminType": non_null(WorkflowsAdminType)}
    )
    protectedAliases = Field(
        list_of(String), args={"adminType": non_null(WorkflowsAdminType)}
    )
    latestRuns = Field(RunConnection)


class Viewer(Type):
    id = non_null(ID)
    flags = list_of(String)
    entity = String
    username = String
    email = String
    admin = Boolean
    teams = Field(TeamConnection)
    apiKeys = Field(ApiKeyConnection)


class ModelEdge(Type):
    node = Field(ProjectFragment)
    cursor = String


class ModelConnection(Type):
    edges = list_of(ModelEdge)
    pageInfo = Field(PageInfo)


class DeleteModelPayload(Type):
    success = Boolean
    __typename = String


class DeleteModelInput(Input):
    id = non_null(String)


class Query(Type):
    viewer = Field(Viewer)
    entity = Field(Entity, args={"name": non_null(String)})
    project = Field(
        ProjectWithRuns, args={"name": non_null(String), "entityName": non_null(String)}
    )
    models = Field(
        ModelConnection, args={"entityName": String, "after": String, "first": Int}
    )


class Mutation(Type):
    deleteModel = Field(DeleteModelPayload, args={"input": non_null(DeleteModelInput)})


class _WClientImpl:
    def __init__(self, client):
        self.endpoint = client

    def viewer(self):  # web
        op = Operation(Query)
        viewer = op.viewer

        for field in ("id", "flags", "entity", "username", "email", "admin"):
            getattr(viewer, field)()

        teams = viewer.teams()
        team_node = teams.edges().node()
        team_node.name()

        return self.endpoint(op)

    def team_page(self, entity_name, workflows_admin_type="MODEL"):  # web
        op = Operation(
            Query,
            name="TeamPage",
            variables={
                "entityName": non_null(String),
                "workflowsAdminType": non_null(WorkflowsAdminType),
            },
        )

        ent = op.entity(name=Variable("entityName"))
        # Top-level scalars
        for field in (
            "available",
            "id",
            "isTeam",
            "memberCount",
            "name",
            "organizationId",
            "photoUrl",
            "projectCount",
            "readOnly",
        ):
            getattr(ent, field)()

        # Nested: claimingEntity
        ce = ent.claimingEntity()
        for field in ("id", "name"):
            getattr(ce, field)()

        # Nested: members
        ent.members().__fields__()
        ent.invites().edges().node().__fields__()
        ent.projects(first=1).edges().node().__fields__()

        # workflowsAdmins & protectedAliases
        wf = ent.workflowsAdmins(adminType=Variable("workflowsAdminType"))
        for field in ("id", "username", "name", "email"):
            getattr(wf, field)()
        ent.protectedAliases(adminType=Variable("workflowsAdminType"))

        return self.endpoint(
            op,
            {
                "entityName": entity_name,
                "workflowsAdminType": workflows_admin_type,
            },
        )

    def delete_model(self, model_id):  # web
        op = Operation(
            Mutation,
            name="deleteModel",
            variables={
                "id": non_null(String),
            },
        )

        delete_model = op.deleteModel(input={"id": Variable("id")})
        delete_model.success()

        return self.endpoint(op, {"id": model_id})

    def entity_runs(self, entity_name):  # web
        op = Operation(
            Query,
            name="EntityRuns",
            variables={
                "entityName": non_null(String),
            },
        )

        entity = op.entity(name=Variable("entityName"))
        entity.id()

        latest_runs = entity.latestRuns()
        run_edges = latest_runs.edges()
        run_edges.__fields__()

        return self.endpoint(op, {"entityName": entity_name})

    def run_full_history(self, project, entity, name, samples=None):  # web
        op = Operation(
            Query,
            name="RunFullHistory",
            variables={
                "project": non_null(String),
                "entity": non_null(String),
                "name": non_null(String),
                "samples": Int,
            },
        )

        project_node = op.project(
            name=Variable("project"), entityName=Variable("entity")
        )
        run_node = project_node.run(name=Variable("name"))
        run_node.history(samples=Variable("samples"))

        return self.endpoint(
            op,
            {
                "project": project,
                "entity": entity,
                "name": name,
                "samples": samples,
            },
        )

    def runs(
        self,
        project,
        entity,
        cursor=None,
        per_page=None,
        order="+created_at",
        filters="{}",
    ):  # py
        op = Operation(
            Query,
            name="Runs",
            variables={
                "project": non_null(String),
                "entity": non_null(String),
                "cursor": String,
                "perPage": Int,
                "order": String,
                "filters": JSONString,
            },
        )

        project_node = op.project(
            name=Variable("project"), entityName=Variable("entity")
        )
        project_node.runCount(filters=Variable("filters"))
        runs = project_node.runs(
            filters=Variable("filters"),
            after=Variable("cursor"),
            first=Variable("perPage"),
            order=Variable("order"),
        )
        runs.__fields__()

        return self.endpoint(
            op,
            {
                "project": project,
                "entity": entity,
                "cursor": cursor,
                "perPage": per_page,
                "order": order,
                "filters": filters,
            },
        )

    def projects(self, entity=None, cursor=None, per_page=None):  # py
        op = Operation(
            Query,
            name="Projects",
            variables={
                "entity": String,
                "cursor": String,
                "perPage": Int,
            },
        )

        models = op.models(
            entityName=Variable("entity"),
            after=Variable("cursor"),
            first=Variable("perPage"),
        )
        models.__fields__()
        return self.endpoint(
            op,
            {
                "entity": entity,
                "cursor": cursor,
                "perPage": per_page,
            },
        )
