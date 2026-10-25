"""Full authoring workspace collaboration on a disposable PostgreSQL database."""
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.parse import urlencode

import test_account_workspaces as account_tests
from test_studio_workspace import author_project
from paramyth.studio.studio_db import connection
from paramyth.storage import save


@unittest.skipUnless(os.environ.get('PARAMYTH_TEST_DATABASE_URL'), 'Set a disposable PostgreSQL URL')
class TeamWorkspaceTests(unittest.TestCase):
    make_app = account_tests.AccountWorkspaceTests.make_app
    client = account_tests.AccountWorkspaceTests.client
    signup = account_tests.AccountWorkspaceTests.signup
    headers = account_tests.AccountWorkspaceTests.headers
    project = account_tests.AccountWorkspaceTests.project

    def setUp(self):
        account_tests.AccountWorkspaceTests.setUp(self)
        self.v, self.vu = self.signup('viewer')
        self.o, self.ou = self.signup('outsider')
        response = self.a.post('/api/v1/studios', json={'name':'Shared harbor'})
        self.assertEqual(response.status_code,201,response.text)
        self.studio = response.json()
        self.sid = self.studio['id']
        self.invite(self.b, self.bu, 'editor')
        self.invite(self.v, self.vu, 'viewer')

    def invite(self, client, user, role):
        response = self.a.post(f'/api/v1/studios/{self.sid}/invitations',json={'email':user['email'],'role':role})
        self.assertEqual(response.status_code,201,response.text)
        response = client.post('/api/v1/invitations/accept',json={'token':response.json()['token']})
        self.assertEqual(response.status_code,200,response.text)

    def url(self,route,**params):
        return route+'?'+urlencode({'studio_id':self.sid,**params})

    def shared(self,client,title='Shared light'):
        response=client.post(self.url('/api/ui/projects'),json={'project':author_project(title)},headers=self.headers(client))
        self.assertEqual(response.status_code,200,response.text)
        return response.json()

    def tearDown(self):
        with connection() as conn:
            conn.execute('DELETE FROM paramyth.studios WHERE owner_id = ANY(%s::uuid[])',([u['id'] for u in self.users],))
        account_tests.AccountWorkspaceTests.tearDown(self)

    def test_shared_copy_keeps_writing_assets_jobs_and_private_original(self):
        personal=self.project(self.a)
        runtime=self.app.state.workspaces.get(self.au['id'])
        root=runtime.folder(personal['id'])
        for path,value in [('images/kept.png','image-data'),('soundtracks/kept.wav','audio-data'),('production/plans/kept.json',{'title':'Shared plan'})]:
            save(root/path,value)
        runtime.jobs['complete-image']={'id':'complete-image','project_id':personal['id'],'kind':'image','status':'complete','created_at':'2026-01-01','result':{'id':'kept'}}
        runtime.persist('complete-image')
        response=self.a.post(f'/api/ui/projects/{personal["id"]}/share',json={'studio_id':self.sid},headers=self.headers(self.a))
        self.assertEqual(response.status_code,200,response.text)
        ident=response.json()['project_id']
        self.assertNotEqual(ident,personal['id'])
        for client in (self.a,self.b,self.v):
            workspace=client.get(self.url('/api/ui/workspace')).json()
            self.assertEqual(workspace['projects'][0]['id'],ident)
            self.assertEqual(workspace['projects'][0]['scenes'][0]['content'],'The bell cracked.')
            for path in ('images/kept.png','soundtracks/kept.wav','production/plans/kept.json'):
                self.assertEqual(client.get(self.url('/api/studio/output',project_id=ident,path=path)).status_code,200,path)
            self.assertEqual(client.get(self.url('/api/job/complete-image')).json()['status'],'complete')
        self.assertEqual(self.o.get(self.url('/api/ui/workspace')).status_code,404)
        self.assertEqual(self.a.get('/api/ui/workspace').json()['projects'][0]['id'],personal['id'])
        self.assertEqual(self.b.get('/api/ui/workspace').json()['projects'],[])
        again=self.a.post(f'/api/ui/projects/{personal["id"]}/share',json={'studio_id':self.sid},headers=self.headers(self.a))
        self.assertEqual(again.json()['project_id'],ident)

    def test_shared_creation_drafts_conflicts_and_manuscript_versions(self):
        p=self.shared(self.b)
        ident=p['id'];route=self.url(f'/api/ui/projects/{ident}/workspace')
        data={'changes':{'creative.input':'A shared lighthouse'},'versions':{}}
        saved=self.a.patch(route,json=data,headers=self.headers(self.a))
        self.assertEqual(saved.status_code,200,saved.text)
        conflict=self.b.patch(route,json={'changes':{'creative.input':'A different lighthouse'},'versions':{}},headers=self.headers(self.b))
        self.assertEqual(conflict.status_code,409)
        self.assertEqual(self.b.patch(route,json={'changes':{'music.direction':'Sparse cello'},'versions':{}},headers=self.headers(self.b)).status_code,200)
        state=self.a.get(self.url('/api/ui/workspace')).json()
        self.assertEqual(state['drafts'][ident]['creative.input'],'A shared lighthouse')
        versions=state['draftRevisions'][ident]
        self.assertEqual(self.b.patch(route,json={'changes':{'creative.input':'Agreed direction'},'versions':versions},headers=self.headers(self.b)).status_code,200)
        edited={**p,'title':'Edited by teammate'}
        self.assertEqual(self.b.put(self.url(f'/api/ui/projects/{ident}'),json=edited,headers=self.headers(self.b)).status_code,200)
        self.assertEqual(self.a.put(self.url(f'/api/ui/projects/{ident}'),json=p,headers=self.headers(self.a)).status_code,409)

    def test_generated_images_and_jobs_are_shared_only_with_members(self):
        from test_images import response
        from test_studio_projects import wait
        p=self.shared(self.b)
        with patch.dict(os.environ, {'MUSE_IMAGE_API_KEY':'local-test-provider'}), patch('paramyth.image_studio.request_json', return_value=response()) as provider:
            result=self.b.post(self.url('/api/images/generate',project_id=p['id']),json={'model':'muse-image-1.0','prompt':'Harbor at dawn','kind':'scene','title':'Harbor'},headers=self.headers(self.b))
            self.assertEqual(result.status_code,202,result.text)
            runtime=self.app.state.workspaces.for_studio(self.bu['id'],self.studio)
            job=wait(runtime,result.json()['job_id'])
            self.assertEqual(job['status'],'complete',job)
            provider.assert_called_once()
        asset=self.url(f'/media/images/{job["result"]["id"]}/0.png',project_id=p['id'])
        for client in (self.a,self.b,self.v):
            self.assertEqual(client.get(asset).content[:4],b'\x89PNG')
            self.assertEqual(client.get(self.url('/api/job/'+job['id'])).json()['status'],'complete')
        self.assertEqual(self.o.get(asset).status_code,404)

    def test_viewer_and_removed_member_cannot_mutate_or_read_after_revocation(self):
        p=self.shared(self.a)
        self.assertEqual(self.v.get(self.url('/api/ui/workspace')).status_code,200)
        for path,body in [('/api/ui/creative',{'operation':'draft'}),('/api/ui/projects',{'project':author_project()}),
                          (f'/api/ui/projects/{p["id"]}/discussion',{'body':'not allowed'})]:
            self.assertEqual(self.v.post(self.url(path,project_id=p['id']),json=body,headers=self.headers(self.v)).status_code,403)
        self.assertEqual(self.v.post(self.url('/api/studio/project/select'),json={'id':p['id']},headers=self.headers(self.v)).status_code,200)
        self.assertEqual(self.b.get(self.url('/api/ui/workspace')).status_code,200)
        self.assertEqual(self.a.delete(f'/api/v1/studios/{self.sid}/members/{self.bu["id"]}').status_code,204)
        self.assertEqual(self.b.get(self.url('/api/ui/workspace')).status_code,404)
        self.assertEqual(self.b.get(self.url('/api/studio/outputs',project_id=p['id'])).status_code,404)

    def test_existing_sql_project_and_comments_are_available_in_full_workflow(self):
        path=f'/api/v1/studios/{self.sid}/projects'
        response=self.a.post(path,json={'title':'Earlier shared story','brief':'An older shared brief','manuscript':'The lantern was lit.'})
        self.assertEqual(response.status_code,201,response.text)
        old=response.json()
        self.assertEqual(self.b.post(path+'/'+old['id']+'/comments',json={'body':'Keep the lantern scene'}).status_code,201)
        response=self.b.get(self.url('/api/ui/workspace'))
        self.assertEqual(response.status_code,200,response.text)
        p=response.json()['projects'][0]
        self.assertEqual(p['title'],old['title'])
        self.assertEqual(p['scenes'][0]['content'],old['manuscript'])
        comments=self.a.get(self.url(f'/api/ui/projects/{p["id"]}/discussion')).json()['comments']
        self.assertEqual(comments[0]['body'],'Keep the lantern scene')
        self.assertEqual(self.b.post(self.url(f'/api/ui/projects/{p["id"]}/discussion'),json={'body':'Now we can work together'},headers=self.headers(self.b)).status_code,200)
        self.assertEqual(len(self.a.get(self.url(f'/api/ui/projects/{p["id"]}/discussion')).json()['comments']),2)

    def test_selection_calendar_and_restart_do_not_cross_member_boundaries(self):
        first=self.shared(self.a,'First light');second=self.shared(self.a,'Second light')
        for client,p in ((self.a,first),(self.b,second)):
            self.assertEqual(client.post(self.url('/api/studio/project/select'),json={'id':p['id']},headers=self.headers(client)).status_code,200)
        self.assertEqual(self.a.get(self.url('/api/ui/workspace')).json()['current'],first['id'])
        self.assertEqual(self.b.get(self.url('/api/ui/workspace')).json()['current'],second['id'])
        team={**self.studio,'role':'owner'}
        alice=self.app.state.workspaces.for_studio(self.au['id'],team)
        bob=self.app.state.workspaces.for_studio(self.bu['id'],{**team,'role':'editor'})
        alice.google.accept({'access_token':'alice-only','refresh_token':'alice-refresh'})
        self.assertEqual(bob.google.access,'')
        self.assertNotEqual(alice.preferences,bob.preferences)
        self.app.state.workspaces.close()
        restarted=self.make_app(self.root)
        c=self.client(restarted)
        c.cookies.update(self.b.cookies)
        self.assertEqual(c.get(self.url('/api/ui/workspace')).json()['current'],second['id'])


if __name__=='__main__':
    unittest.main()
