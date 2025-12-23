from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from python.models import RunGraphEdge, RunGraphNode


def get_graph(run_id: int, session: Session) -> Dict:
    nodes = session.query(RunGraphNode).filter(RunGraphNode.runId == run_id).all()
    edges = session.query(RunGraphEdge).filter(RunGraphEdge.runId == run_id).all()
    
    module_json = {}
    for node in nodes:
        node_dict = {
            "type": node.type,
            "inst_id": node.instId,
            "edges": [],
            "args": node.args or [],
            "kwargs": node.kwargs or {},
        }
        
        if node.order is not None:
            node_dict["order"] = node.order
        if node.label:
            node_dict["label"] = node.label
        if node.nodeId:
            node_dict["node_id"] = node.nodeId
        if node.nodeType:
            node_dict["node_type"] = node.nodeType
        if node.params:
            node_dict["params"] = node.params
            
        module_json[node.name] = node_dict
    
    for edge in edges:
        source_node = next((n for n in nodes if n.nodeId == edge.sourceId), None)
        target_node = next((n for n in nodes if n.nodeId == edge.targetId), None)
        
        if source_node and target_node:
            if source_node.name in module_json:
                module_json[source_node.name]["edges"].append([edge.sourceId, edge.targetId])
    
    return module_json 
