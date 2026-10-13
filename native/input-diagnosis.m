#import <Foundation/Foundation.h>
#include <dlfcn.h>
#include "librime/rime_api.h"

static int emit(NSDictionary *value) {
 NSData *json=[NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
 if(!json)return 2;fwrite(json.bytes,1,json.length,stdout);return 0;
}
int main(int argc,const char **argv) {@autoreleasepool {
 if(argc!=5)return emit(@{@"error":@"诊断参数无效"});
 void *library=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);
 if(!library)return emit(@{@"error":@"无法加载本机 Rime 引擎"});
 RimeApi *(*get_api)(void)=dlsym(library,"rime_get_api");
 if(!get_api)return emit(@{@"error":@"本机 Rime 未提供公共接口"});
 RimeApi *api=get_api();
 if(!RIME_PROVIDED(api,select_schema))return emit(@{@"error":@"本机 Rime 接口不兼容"});
 NSString *dir=[NSString stringWithUTF8String:argv[2]],*build=[dir stringByAppendingPathComponent:@"build"];
 RimeTraits traits={0};RIME_STRUCT_INIT(RimeTraits,traits);
 traits.shared_data_dir=argv[2];traits.user_data_dir=argv[2];traits.prebuilt_data_dir=build.UTF8String;traits.staging_dir=build.UTF8String;traits.log_dir=argv[2];traits.app_name="rime.studio-diagnosis";traits.min_log_level=2;
 api->setup(&traits);api->deployer_initialize(&traits);
 NSString *schemaFile=[dir stringByAppendingPathComponent:[NSString stringWithFormat:@"%s.schema.yaml",argv[3]]];
 Bool compiled=api->deploy_config_file("default.yaml","config_version")&&api->deploy_schema(schemaFile.UTF8String);
 if(!compiled){api->finalize();return emit(@{@"error":@"隔离编译失败，请检查方案依赖、词库及 Lua 配置"});}
 api->initialize(&traits);
 RimeSessionId session=api->create_session();
 if(!session||!api->select_schema(session,argv[3])){if(session)api->destroy_session(session);api->finalize();return emit(@{@"error":@"隔离会话无法载入该方案"});}
 api->set_option(session,"ascii_mode",False);api->set_option(session,"full_shape",False);
 NSMutableArray *keys=[NSMutableArray array],*commits=[NSMutableArray array],*candidates=[NSMutableArray array];
 for(const unsigned char *c=(const unsigned char *)argv[4];*c;c++){
  Bool accepted=api->process_key(session,*c,0);
  [keys addObject:@{@"key":[NSString stringWithFormat:@"%c",*c],@"accepted":@(accepted)}];
  RimeCommit commit={0};RIME_STRUCT_INIT(RimeCommit,commit);
  if(api->get_commit(session,&commit)){if(commit.text)[commits addObject:[NSString stringWithUTF8String:commit.text]?:@""];api->free_commit(&commit);}
 }
 NSString *preedit=@"";Bool more=False;
 for(int page=0;page<20;page++){
  RimeContext context={0};RIME_STRUCT_INIT(RimeContext,context);
  if(!api->get_context(session,&context))break;
  if(page==0&&context.composition.preedit)preedit=[NSString stringWithUTF8String:context.composition.preedit]?:@"";
  for(int i=0;i<context.menu.num_candidates&&candidates.count<100;i++){
   RimeCandidate c=context.menu.candidates[i];[candidates addObject:@{@"text":c.text?([NSString stringWithUTF8String:c.text]?:@""):@"",@"comment":c.comment?([NSString stringWithUTF8String:c.comment]?:@""):@""}];
  }
  more=!context.menu.is_last_page&&context.menu.num_candidates>0;int pageNo=context.menu.page_no;
  api->free_context(&context);if(!more||candidates.count>=100)break;
  if(!api->process_key(session,0xff56,0))break;
  RimeContext after={0};RIME_STRUCT_INIT(RimeContext,after);if(!api->get_context(session,&after))break;Bool advanced=after.menu.page_no>pageNo;api->free_context(&after);if(!advanced)break;
 }
 NSString *version=RIME_PROVIDED(api,get_version)?[NSString stringWithUTF8String:api->get_version()]:@"未知";
 api->destroy_session(session);api->finalize();
 return emit(@{@"compiled":@YES,@"schema":[NSString stringWithUTF8String:argv[3]],@"version":version?:@"未知",@"preedit":preedit,@"candidates":candidates,@"hasMore":@(more),@"commits":commits,@"keys":keys});
}}
