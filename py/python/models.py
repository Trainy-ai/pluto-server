import enum

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.sql import func

Base = declarative_base()



class RunTriggerType(enum.Enum):
    CANCEL = "CANCEL"


class RunStatus(enum.Enum):
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    TERMINATED = "TERMINATED"
    CANCELLED = "CANCELLED"


class Project(Base):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True)
    name = Column(String)

    def __repr__(self):
        return f"<Project(id={self.id}, name={self.name})>"


class Run(Base):
    __tablename__ = "runs"
    id = Column(Integer, primary_key=True)
    name = Column(String)
    projectId = Column(Integer, ForeignKey("projects.id"))
    organizationId = Column(String, ForeignKey("organization.id"))
    loggerSettings = Column(JSON)
    status = Column(Enum(RunStatus))
    statusUpdated = Column(DateTime(timezone=True))
    updatedAt = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    project = relationship("Project", backref="runs")
    organization = relationship("Organization", backref="runs")

    def __repr__(self):
        return (
            f"<Run(id={self.id}, name={self.name}, projectId={self.projectId}, "
            f"organizationId={self.organizationId}, status={self.status}, "
            f"updatedAt={self.updatedAt})>"
        )


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True)
    runId = Column(Integer, ForeignKey("runs.id"))
    organizationId = Column(String)
    createdAt = Column(DateTime(timezone=True), server_default=func.now())
    type = Column(String)
    content = Column(String)

    run = relationship("Run", backref="notifications")

    def __repr__(self):
        return (
            f"<Notification(id={self.id}, runId={self.runId}, "
            f"organizationId={self.organizationId}, type={self.type}, "
            f"content={self.content})>"
        )


class User(Base):
    __tablename__ = "user"

    id = Column(String, primary_key=True)
    name = Column(String)
    email = Column(String, unique=True)
    emailVerified = Column(Boolean)
    image = Column(String)
    createdAt = Column(DateTime)
    updatedAt = Column(DateTime)
    twoFactorEnabled = Column(Boolean)
    role = Column(String)
    banned = Column(Boolean)
    banReason = Column(String)
    banExpires = Column(DateTime)
    finishedOnboarding = Column(Boolean)

    members = relationship("Member", back_populates="user")


class Organization(Base):
    __tablename__ = "organization"

    id = Column(String, primary_key=True)
    name = Column(String)
    slug = Column(String, unique=True)
    logo = Column(String)
    createdAt = Column(DateTime)
    # metadata = Column(String)

    members = relationship("Member", back_populates="organization")


class Member(Base):
    __tablename__ = "member"

    id = Column(String, primary_key=True)
    organizationId = Column(String, ForeignKey("organization.id"))
    userId = Column(String, ForeignKey("user.id"))
    role = Column(String)
    createdAt = Column(DateTime)

    organization = relationship("Organization", back_populates="members")
    user = relationship("User", back_populates="members")


class RunTriggers(Base):
    __tablename__ = "run_triggers"
    id = Column(Integer, primary_key=True)
    runId = Column(Integer, ForeignKey("runs.id"))
    trigger = Column(String)
    createdAt = Column(DateTime(timezone=True), server_default=func.now())
    triggerType = Column(Enum(RunTriggerType))

    run = relationship("Run", backref="triggers")

    def __repr__(self):
        return f"<RunTriggers(id={self.id}, runId={self.runId}, trigger={self.trigger}, triggerType={self.triggerType})>"


class RunGraphNode(Base):
    __tablename__ = "run_graph_nodes"
    id = Column(Integer, primary_key=True)
    runId = Column(Integer, ForeignKey("runs.id"))
    name = Column(String)
    type = Column(String)
    order = Column(Integer, nullable=True)
    label = Column(String, nullable=True)
    nodeId = Column(String, nullable=True)
    nodeType = Column(String, nullable=True)
    instId = Column(String, nullable=True)
    args = Column(JSON, nullable=True)
    kwargs = Column(JSON, nullable=True)
    params = Column(JSON, nullable=True)

    run = relationship("Run", backref="graph_nodes")

    def __repr__(self):
        return (
            f"<RunGraphNode(id={self.id}, runId={self.runId}, name={self.name}, "
            f"type={self.type}, nodeId={self.nodeId})>"
        )


class RunGraphEdge(Base):
    __tablename__ = "run_graph_edges"
    id = Column(Integer, primary_key=True)
    runId = Column(Integer, ForeignKey("runs.id"))
    sourceId = Column(String)
    targetId = Column(String)

    run = relationship("Run", backref="graph_edges")

    def __repr__(self):
        return (
            f"<RunGraphEdge(id={self.id}, runId={self.runId}, "
            f"sourceId={self.sourceId}, targetId={self.targetId})>"
        )


class ApiKey(Base):
    __tablename__ = "api_key"
    
    id = Column(String, primary_key=True)
    key = Column(String, unique=True)
    name = Column(String)
    keyString = Column(String, default="*********")
    organizationId = Column(String, ForeignKey("organization.id"))
    userId = Column(String, ForeignKey("user.id"))
    createdAt = Column(DateTime)
    isHashed = Column(Boolean, default=True)
    lastUsed = Column(DateTime, nullable=True)
    expiresAt = Column(DateTime, nullable=True)
    
    organization = relationship("Organization", backref="api_keys")
    user = relationship("User", backref="api_keys")
    
    def __repr__(self):
        return f"<ApiKey(id={self.id}, key={self.key}, name={self.name}, organizationId={self.organizationId})>"
