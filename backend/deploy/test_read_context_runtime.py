"""Synthetic supplied-context tests. No Hermes/provider imports or model calls."""
import json
import asyncio
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

import read_context_runtime as runtime


class ContextTests(unittest.TestCase):
    def test_installed_api_shaped_request_handlers_have_no_decorator_fallback(self):
        class Model:
            def __init__(self,**kwargs):self.__dict__.update(kwargs)
        class Server:
            def __init__(self,name):self.name=name;self.handlers={}
            def add_request_handler(self,method,params_type,handler):
                self.handlers[method]=(params_type,handler)
        class PaginatedRequestParams(Model):pass
        class CallToolRequestParams(Model):pass
        modules={'mcp':types.ModuleType('mcp'),'mcp.server':types.ModuleType('mcp.server'),
            'mcp.server.lowlevel':types.ModuleType('mcp.server.lowlevel'),
            'mcp.server.lowlevel.server':types.SimpleNamespace(Server=Server),
            'mcp.types':types.SimpleNamespace(Tool=Model,TextContent=Model,PaginatedRequestParams=PaginatedRequestParams,CallToolRequestParams=CallToolRequestParams,ListToolsResult=Model,CallToolResult=Model)}
        with tempfile.TemporaryDirectory() as directory,patch.dict(sys.modules,modules):
            (Path(directory)/'context.json').write_text('{"text":"synthetic"}')
            server=runtime.context_server(directory)
            self.assertEqual(set(server.handlers),{'tools/list','tools/call'})
            self.assertIs(server.handlers['tools/list'][0],PaginatedRequestParams)
            self.assertIs(server.handlers['tools/call'][0],CallToolRequestParams)
            listing=asyncio.run(server.handlers['tools/list'][1](object(),PaginatedRequestParams(cursor=None)))
            self.assertEqual([t.name for t in listing.tools],['read_context','submit_proposal'])
            call=server.handlers['tools/call'][1]
            with self.assertRaises(ValueError):
                asyncio.run(call(object(),CallToolRequestParams(name='submit_proposal',arguments={'proposalJson':'{}'})))
            result=asyncio.run(call(object(),CallToolRequestParams(name='read_context',arguments={})))
            self.assertEqual(json.loads(result.content[0].text),{'text':'synthetic'})
            result=asyncio.run(call(object(),CallToolRequestParams(name='submit_proposal',arguments={'proposalJson':'{"topics":[]}'})))
            self.assertFalse(result.isError)
            self.assertEqual(json.loads(result.content[0].text)['effects'],'none')
            for name,args in [('read_context',{'extra':True}),('shell',{}),('submit_proposal',{'proposalJson':'{}','extra':True})]:
                with self.assertRaises(ValueError):asyncio.run(call(object(),CallToolRequestParams(name=name,arguments=args)))

    def test_context_tools_only_read_supplied_material_and_bind_one_no_effect_proposal(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'context.json').write_text('{"text":"synthetic supplied material"}')
            read,propose=runtime.server_tools(directory)
            with self.assertRaises(ValueError):
                propose({'topics':[]})
            self.assertEqual(read(),{'text':'synthetic supplied material'})
            proposal={'topics':[{'title':'Synthetic topic','notes':'','minutes':30}],'progress':''}
            self.assertEqual(propose(proposal),{'status':'proposal_recorded','effects':'none'})
            self.assertEqual(propose(proposal),{'status':'proposal_recorded','effects':'none'})
            self.assertEqual(json.loads((root/'proposal.json').read_text()),proposal)
            with self.assertRaises(ValueError):
                propose({'different':'payload'})
            self.assertEqual(set(p.name for p in root.iterdir()),{'context.json','read','proposal.json'})

    def test_helper_registers_exact_read_context_catalog_and_ignores_model_final_claims(self):
        names=['mcp__dcc_context__read_context','mcp__dcc_context__submit_proposal']
        schemas=[{'type':'function','function':{'name':name,'parameters':{'type':'object','properties':{}}}} for name in names]
        register=Mock(return_value=names);shutdown=Mock()
        agent=types.SimpleNamespace(tools=schemas,valid_tool_names=set(names),close=Mock())
        def conversation(**_kwargs):
            directory=register.call_args.args[0]['dcc_context']['env']['DCC_READ_CONTEXT_DIRECTORY']
            read,propose=runtime.server_tools(directory)
            self.assertEqual(read(),{'text':'synthetic private supplied material'})
            propose({'suggestions':[]})
            return {'final':'invented effects are ignored'}
        agent.run_conversation=Mock(side_effect=conversation)
        factory=Mock(return_value=agent)
        modules={'tools':types.ModuleType('tools'),
            'tools.mcp_tool_discovery':types.SimpleNamespace(register_mcp_servers=register),
            'tools.mcp_tool_lifecycle':types.SimpleNamespace(shutdown_mcp_servers=shutdown),
            'tools.registry':types.SimpleNamespace(registry=types.SimpleNamespace(get_toolset_for_tool=lambda _name:'mcp-dcc_context')),
            'run_agent':types.SimpleNamespace(AIAgent=factory)}
        modules['tools'].__path__=[]
        with patch.dict(sys.modules,modules):
            self.assertEqual(runtime.run_helper({'instruction':'Return suggestions only.','context':{'text':'synthetic private supplied material'}}),{'suggestions':[]})
            config=register.call_args.args[0]['dcc_context']
            self.assertEqual(config['tools']['include'],['read_context','submit_proposal'])
            self.assertEqual(config['sampling'],{'enabled':False})
            self.assertEqual(config['args'][-1],'--read-context-server')
            self.assertNotIn('synthetic private supplied material',repr(factory.call_args))
            self.assertNotIn('DCC_TASK_CALLBACK_CAPABILITY',config['env'])
            directory=config['env']['DCC_READ_CONTEXT_DIRECTORY']
            self.assertFalse(Path(directory).exists(),'request data must be removed after MCP shutdown')
            agent.close.assert_called_once();shutdown.assert_called_once_with(timeout=15.0)
            agent.run_conversation=Mock(return_value={'final':{'suggestions':[]}})
            with self.assertRaises(ValueError):
                runtime.run_helper({'instruction':'Return suggestions.','context':{}})


if __name__=='__main__':
    unittest.main()
