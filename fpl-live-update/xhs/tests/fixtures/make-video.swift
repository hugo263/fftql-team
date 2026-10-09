import Foundation
import AVFoundation
import CoreVideo
let url=URL(fileURLWithPath:"/private/tmp/xhs-ui-test.mp4")
try? FileManager.default.removeItem(at:url)
let writer=try AVAssetWriter(outputURL:url,fileType:.mp4)
let input=AVAssetWriterInput(mediaType:.video,outputSettings:[AVVideoCodecKey:AVVideoCodecType.h264,AVVideoWidthKey:160,AVVideoHeightKey:120])
let adapter=AVAssetWriterInputPixelBufferAdaptor(assetWriterInput:input,sourcePixelBufferAttributes:[kCVPixelBufferPixelFormatTypeKey as String:kCVPixelFormatType_32ARGB,kCVPixelBufferWidthKey as String:160,kCVPixelBufferHeightKey as String:120])
writer.add(input)
writer.startWriting();writer.startSession(atSourceTime:.zero)
for i in 0..<30 {
 var pixel:CVPixelBuffer?
 CVPixelBufferCreate(kCFAllocatorDefault,160,120,kCVPixelFormatType_32ARGB,nil,&pixel)
 let b=pixel!;CVPixelBufferLockBaseAddress(b,[])
 let data=CVPixelBufferGetBaseAddress(b)!.assumingMemoryBound(to:UInt8.self),row=CVPixelBufferGetBytesPerRow(b)
 for y in 0..<120 {for x in 0..<160 {let o=y*row+x*4;data[o]=255;data[o+1]=30;data[o+2]=UInt8(90+i*3);data[o+3]=70}}
 CVPixelBufferUnlockBaseAddress(b,[])
 let until=Date().addingTimeInterval(5)
 while !input.isReadyForMoreMediaData && Date()<until {Thread.sleep(forTimeInterval:0.005)}
 if !adapter.append(b,withPresentationTime:CMTime(value:Int64(i),timescale:30)){throw writer.error!}
}
input.markAsFinished()
let done=DispatchSemaphore(value:0)
writer.finishWriting{done.signal()}
if done.wait(timeout:.now()+15) != .success {fatalError("timeout")}
if writer.status != .completed {fatalError("encoding failed")}
print("synthetic MP4 ready")
